/* =========================================================
   Pulso · Lector de noticias
   Reto 5 — Programación web del lado del cliente (UVEG)
   Autor: Irvin Daniel Hernández Márquez

   Flujo general:
   1) El usuario elige fuente, sección o tema y cantidad.
   2) obtenerNoticias() hace la petición con fetch().
   3) La respuesta JSON se convierte a un formato común.
   4) mostrarNoticias() crea las notas en el DOM.
   5) Si algo falla, mostrarMensaje() explica el problema.
   ========================================================= */

'use strict';

/* ---------- 1. Configuración de las APIs ---------- */

const TIEMPO_LIMITE_MS = 10000;          // 10 s máximo por petición
const INTERVALO_AUTO_MS = 5 * 60 * 1000; // actualización automática: 5 min

const FUENTES = {
  hackernews: {
    nombre: 'Hacker News',
    requiereClave: false,
    secciones: [
      { id: 'portada', etiqueta: 'Portada' },
      { id: 'recientes', etiqueta: 'Lo más reciente' },
      { id: 'ia', etiqueta: 'Inteligencia artificial', consulta: 'AI' },
      { id: 'nvidia', etiqueta: 'Nvidia', consulta: 'Nvidia' },
      { id: 'apple', etiqueta: 'Apple', consulta: 'Apple' },
      { id: 'seguridad', etiqueta: 'Seguridad', consulta: 'security' },
      { id: 'programacion', etiqueta: 'Programación', consulta: 'programming' },
    ],

    construirUrl({ busqueda, cantidad, seccion }) {
      const tema = busqueda || seccion.consulta;
      const ruta = seccion.id === 'portada' && !busqueda ? 'search' : 'search_by_date';
      const url = new URL(`https://hn.algolia.com/api/v1/${ruta}`);
      url.searchParams.set('hitsPerPage', cantidad);
      url.searchParams.set('tags', ruta === 'search' ? 'front_page' : 'story');
      if (tema) url.searchParams.set('query', tema);
      return url;
    },

    // JSON recibido: { hits: [ {...}, ... ], nbHits, page, ... }
    extraerArticulos(json) {
      if (!Array.isArray(json.hits)) {
        throw new ErrorNoticias('formato', 'La respuesta no contiene la lista "hits".');
      }
      return json.hits.map((a) => {
        const url = a.url || `https://news.ycombinator.com/item?id=${a.objectID}`;
        const detalle = `${a.points ?? 0} puntos y ${a.num_comments ?? 0} comentarios en Hacker News.`;
        return {
          id: a.objectID,
          titulo: a.title,
          resumen: a.story_text ? textoPlano(a.story_text) : detalle,
          url,
          imagen: '',
          fuente: dominio(url),
          autor: a.author || '',
          fecha: a.created_at,
        };
      });
    },
  },

  spaceflight: {
    nombre: 'Spaceflight News',
    requiereClave: false,
    secciones: [
      { id: 'todo', etiqueta: 'Portada' },
      { id: 'nasa', etiqueta: 'NASA', consulta: 'NASA' },
      { id: 'spacex', etiqueta: 'SpaceX', consulta: 'SpaceX' },
      { id: 'luna', etiqueta: 'Luna', consulta: 'Moon' },
      { id: 'marte', etiqueta: 'Marte', consulta: 'Mars' },
      { id: 'esa', etiqueta: 'ESA', consulta: 'ESA' },
    ],

    construirUrl({ busqueda, cantidad, seccion }) {
      const tema = busqueda || seccion.consulta;
      const url = new URL('https://api.spaceflightnewsapi.net/v4/articles/');
      url.searchParams.set('limit', cantidad);
      url.searchParams.set('ordering', '-published_at');
      if (tema) url.searchParams.set('search', tema);
      return url;
    },

    // JSON recibido: { count, next, previous, results: [ {...}, ... ] }
    extraerArticulos(json) {
      if (!Array.isArray(json.results)) {
        throw new ErrorNoticias('formato', 'La respuesta no contiene la lista "results".');
      }
      return json.results.map((a) => ({
        id: a.id,
        titulo: a.title,
        resumen: a.summary,
        url: a.url,
        imagen: a.image_url,
        fuente: a.news_site,
        autor: a.authors?.map((p) => p.name).join(', ') || '',
        fecha: a.published_at,
      }));
    },
  },

  gnews: {
    nombre: 'GNews',
    requiereClave: true,
    secciones: [
      { id: 'general', etiqueta: 'Portada' },
      { id: 'nation', etiqueta: 'Nacional' },
      { id: 'world', etiqueta: 'Mundo' },
      { id: 'business', etiqueta: 'Negocios' },
      { id: 'technology', etiqueta: 'Tecnología' },
      { id: 'entertainment', etiqueta: 'Espectáculos' },
      { id: 'sports', etiqueta: 'Deportes' },
      { id: 'science', etiqueta: 'Ciencia' },
      { id: 'health', etiqueta: 'Salud' },
    ],

    construirUrl({ busqueda, cantidad, clave, seccion }) {
      const ruta = busqueda ? 'search' : 'top-headlines';
      const url = new URL(`https://gnews.io/api/v4/${ruta}`);
      url.searchParams.set('lang', 'es');
      url.searchParams.set('country', 'mx');
      url.searchParams.set('max', Math.min(cantidad, 10)); // el plan gratuito permite 10
      url.searchParams.set('apikey', clave);
      if (busqueda) url.searchParams.set('q', busqueda);
      else url.searchParams.set('category', seccion.id);
      return url;
    },

    // JSON recibido: { totalArticles, articles: [ {...}, ... ] }
    extraerArticulos(json) {
      if (!Array.isArray(json.articles)) {
        throw new ErrorNoticias('formato', 'La respuesta no contiene la lista "articles".');
      }
      return json.articles.map((a) => ({
        id: a.id || a.url,
        titulo: a.title,
        resumen: a.content || a.description,
        url: a.url,
        imagen: a.image,
        fuente: a.source?.name || 'GNews',
        autor: '',
        fecha: a.publishedAt,
      }));
    },
  },
};

/* Error propio para distinguir el tipo de falla y mostrar un mensaje claro */
class ErrorNoticias extends Error {
  constructor(tipo, mensaje) {
    super(mensaje);
    this.name = 'ErrorNoticias';
    this.tipo = tipo; // 'red' | 'tiempo' | 'http' | 'formato' | 'clave'
  }
}

/* ---------- 2. Referencias al DOM ---------- */

const $ = (id) => document.getElementById(id);
const ui = {
  form: $('form-controles'),
  fuente: $('sel-fuente'),
  busqueda: $('txt-busqueda'),
  cantidad: $('sel-cantidad'),
  campoClave: $('campo-clave'),
  clave: $('txt-clave'),
  auto: $('chk-auto'),
  refrescar: $('btn-refrescar'),
  reintentar: $('btn-reintentar'),
  fechaHoy: $('fecha-hoy'),
  estado: $('estado-actualizacion'),
  navSecciones: $('nav-secciones'),
  tituloArea: $('titulo-area'),
  lista: $('lista-noticias'),
  mensaje: $('mensaje'),
  mensajeTitulo: $('mensaje-titulo'),
  mensajeTexto: $('mensaje-texto'),
  plantilla: $('plantilla-tarjeta'),
  modal: $('modal-noticia'),
  modalSeccion: $('modal-seccion'),
  modalImagen: $('modal-imagen'),
  modalMeta: $('modal-meta'),
  modalTitulo: $('modal-titulo'),
  modalResumen: $('modal-resumen'),
  modalEnlace: $('modal-enlace'),
  cerrarModal: $('btn-cerrar-modal'),
};

let controladorActual = null; // permite cancelar una petición en curso
let temporizadorAuto = null;
let noticiasActuales = [];
let numeroPeticion = 0;       // identifica la petición más reciente
let seccionActual = null;     // sección elegida en la barra de navegación

/* ---------- 3. Petición con Fetch ---------- */

async function obtenerNoticias(parametros) {
  const fuente = FUENTES[parametros.fuente];

  if (fuente.requiereClave && !parametros.clave) {
    throw new ErrorNoticias('clave',
      'GNews necesita una clave gratuita de gnews.io. Pégala en el campo «Clave de GNews» o elige otra fuente.');
  }
  if (!navigator.onLine) {
    throw new ErrorNoticias('red', 'Tu dispositivo no tiene conexión a internet.');
  }

  // Si el usuario refresca antes de que termine la petición anterior, se cancela
  controladorActual?.abort();
  const controlador = new AbortController();
  controladorActual = controlador;
  const temporizador = setTimeout(() => controlador.abort('tiempo'), TIEMPO_LIMITE_MS);

  let respuesta;
  try {
    respuesta = await fetch(fuente.construirUrl(parametros), {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controlador.signal,
    });
  } catch (error) {
    if (controlador.signal.reason === 'tiempo') {
      throw new ErrorNoticias('tiempo', 'La API tardó demasiado en responder.');
    }
    if (error.name === 'AbortError') throw error; // cancelada a propósito
    throw new ErrorNoticias('red', 'No fue posible conectar con la API (servicio caído o bloqueo CORS).');
  } finally {
    clearTimeout(temporizador);
  }

  // fetch() solo falla por problemas de red; los códigos 4xx/5xx se revisan aquí
  if (!respuesta.ok) {
    throw new ErrorNoticias('http', describirEstadoHttp(respuesta.status));
  }

  let json;
  try {
    json = await respuesta.json(); // convierte el cuerpo de texto JSON a objeto
  } catch {
    throw new ErrorNoticias('formato', 'La API respondió algo que no es JSON válido.');
  }

  return fuente.extraerArticulos(json).filter((n) => n.titulo && n.url);
}

function describirEstadoHttp(codigo) {
  const mensajes = {
    400: 'La petición tiene parámetros incorrectos (400).',
    401: 'La clave de la API no es válida (401).',
    403: 'La API negó el acceso; revisa tu clave o plan (403).',
    404: 'No se encontró el recurso solicitado (404).',
    426: 'El plan gratuito de la API no permite peticiones desde este dominio (426).',
    429: 'Se alcanzó el límite de peticiones diarias de la API (429).',
  };
  if (mensajes[codigo]) return mensajes[codigo];
  if (codigo >= 500) return `El servidor de la API no está disponible en este momento (${codigo}).`;
  return `La API respondió con un código inesperado (${codigo}).`;
}

/* ---------- 4. Ciclo de carga ---------- */

async function cargarNoticias() {
  const parametros = {
    fuente: ui.fuente.value,
    busqueda: ui.busqueda.value.trim(),
    cantidad: Number(ui.cantidad.value),
    clave: ui.clave.value.trim(),
    seccion: seccionActual,
  };
  const miPeticion = ++numeroPeticion;

  ui.tituloArea.textContent = parametros.busqueda
    ? `Resultados: ${parametros.busqueda}`
    : seccionActual.etiqueta;
  ocultarMensaje();
  mostrarEsqueletos(parametros.cantidad);
  indicarCarga(true);

  try {
    const noticias = await obtenerNoticias(parametros);
    noticiasActuales = noticias;

    if (noticias.length === 0) {
      ui.lista.replaceChildren();
      mostrarMensaje('vacio', 'No hay noticias disponibles',
        parametros.busqueda
          ? `No se encontraron noticias sobre «${parametros.busqueda}». Prueba con otro tema u otra fuente.`
          : 'La fuente no devolvió noticias por ahora. Intenta de nuevo más tarde.');
    } else {
      mostrarNoticias(noticias);
    }
    ui.estado.textContent = `Actualizado a las ${formatearHora(new Date())} · ${FUENTES[parametros.fuente].nombre}`;
  } catch (error) {
    if (error.name === 'AbortError') return; // la reemplazó una petición más nueva
    console.error('[Pulso]', error);
    ui.lista.replaceChildren();
    mostrarMensaje('error', tituloError(error.tipo), error.message);
    ui.estado.textContent = 'Error al actualizar';
    if (error.tipo === 'clave') ui.clave.focus();
  } finally {
    if (miPeticion === numeroPeticion) indicarCarga(false);
  }
}

function tituloError(tipo) {
  return {
    red: 'Sin conexión con la API',
    tiempo: 'Tiempo de espera agotado',
    http: 'La API respondió con un error',
    formato: 'Respuesta inesperada',
    clave: 'Falta la clave de la API',
  }[tipo] || 'Ocurrió un error';
}

/* ---------- 5. Presentación en el DOM ---------- */

function mostrarNoticias(noticias) {
  const fragmento = document.createDocumentFragment();

  noticias.forEach((noticia, indice) => {
    const nota = ui.plantilla.content.firstElementChild.cloneNode(true);
    if (indice === 0) nota.classList.add('nota--principal');
    nota.style.animationDelay = `${indice * 50}ms`;

    const figura = nota.querySelector('.nota__media');
    const img = nota.querySelector('.nota__imagen');
    if (noticia.imagen) {
      img.src = noticia.imagen;
      img.alt = noticia.titulo;
      img.addEventListener('error', () => { figura.remove(); nota.classList.add('nota--sin-imagen'); });
    } else {
      figura.remove();
      nota.classList.add('nota--sin-imagen');
    }

    // textContent evita inyectar HTML ajeno (protección contra XSS)
    nota.querySelector('.nota__seccion').textContent = noticia.fuente;
    const enlace = nota.querySelector('.nota__enlace');
    enlace.textContent = noticia.titulo;
    enlace.dataset.indice = indice;
    nota.querySelector('.nota__resumen').textContent = noticia.resumen || '';
    const autor = noticia.autor ? `Por ${noticia.autor} · ` : '';
    nota.querySelector('.nota__meta').textContent = autor + tiempoRelativo(noticia.fecha);

    fragmento.append(nota);
  });

  ui.lista.replaceChildren(fragmento);
}

function mostrarEsqueletos(cantidad) {
  const molde = `
    <div class="esqueleto" aria-hidden="true">
      <div class="esqueleto__bloque esqueleto__media"></div>
      <div class="esqueleto__bloque esqueleto__linea"></div>
      <div class="esqueleto__bloque esqueleto__linea"></div>
      <div class="esqueleto__bloque esqueleto__linea"></div>
    </div>`;
  ui.lista.innerHTML = molde.repeat(Math.min(cantidad, 6));
}

function mostrarMensaje(tipo, titulo, texto) {
  ui.mensaje.classList.toggle('mensaje--vacio', tipo === 'vacio');
  ui.mensajeTitulo.textContent = titulo;
  ui.mensajeTexto.textContent = texto;
  ui.mensaje.hidden = false;
}

function ocultarMensaje() {
  ui.mensaje.hidden = true;
}

function indicarCarga(cargando) {
  ui.refrescar.disabled = cargando;
  ui.refrescar.classList.toggle('girando', cargando);
  ui.lista.setAttribute('aria-busy', String(cargando));
  if (cargando) ui.estado.textContent = 'Cargando noticias…';
}

/* Barra de secciones: se crea según la fuente elegida */
function pintarSecciones() {
  const fuente = FUENTES[ui.fuente.value];
  if (!fuente.secciones.includes(seccionActual)) seccionActual = fuente.secciones[0];

  ui.navSecciones.replaceChildren(...fuente.secciones.map((seccion) => {
    const li = document.createElement('li');
    const boton = document.createElement('button');
    boton.type = 'button';
    boton.className = 'secciones__boton';
    boton.textContent = seccion.etiqueta;
    boton.dataset.seccion = seccion.id;
    boton.setAttribute('aria-current', String(seccion === seccionActual && !ui.busqueda.value.trim()));
    li.append(boton);
    return li;
  }));
}

/* Ventana modal para leer la noticia completa */
function abrirNoticia(noticia) {
  ui.modalImagen.hidden = !noticia.imagen;
  if (noticia.imagen) {
    ui.modalImagen.src = noticia.imagen;
    ui.modalImagen.alt = noticia.titulo;
  }
  const autor = noticia.autor ? `Por ${noticia.autor} · ` : '';
  ui.modalSeccion.textContent = noticia.fuente;
  ui.modalTitulo.textContent = noticia.titulo;
  ui.modalMeta.textContent = autor + formatearFecha(noticia.fecha);
  ui.modalResumen.textContent = noticia.resumen || 'Esta noticia no incluye resumen.';
  ui.modalResumen.classList.toggle('modal__resumen--capitular', ui.modalResumen.textContent.length > 200);
  ui.modalEnlace.href = noticia.url;
  ui.modal.showModal();
}

/* ---------- 6. Utilidades (fechas en es-MX y texto) ---------- */

function formatearFecha(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  return new Intl.DateTimeFormat('es-MX', { dateStyle: 'long', timeStyle: 'short' }).format(fecha);
}

function formatearHora(fecha) {
  return new Intl.DateTimeFormat('es-MX', { hour: '2-digit', minute: '2-digit' }).format(fecha);
}

function tiempoRelativo(iso) {
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return '';
  const minutos = Math.round((fecha - Date.now()) / 60000);
  const rtf = new Intl.RelativeTimeFormat('es-MX', { numeric: 'auto' });
  if (Math.abs(minutos) < 60) return rtf.format(minutos, 'minute');
  if (Math.abs(minutos) < 1440) return rtf.format(Math.round(minutos / 60), 'hour');
  return rtf.format(Math.round(minutos / 1440), 'day');
}

// Convierte HTML de la API en texto plano (DOMParser no ejecuta scripts)
function textoPlano(html) {
  return new DOMParser().parseFromString(html, 'text/html').body.textContent.trim();
}

function dominio(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'Hacker News'; }
}

/* ---------- 7. Preferencias guardadas (localStorage) ---------- */

function leerPreferencia(clave) {
  try { return localStorage.getItem(clave); } catch { return null; }
}
function guardarPreferencia(clave, valor) {
  try { localStorage.setItem(clave, valor); } catch { /* almacenamiento no disponible */ }
}

/* ---------- 8. Eventos ---------- */

ui.form.addEventListener('submit', (evento) => {
  evento.preventDefault(); // evita que el formulario recargue la página
  guardarPreferencia('pulso-clave-gnews', ui.clave.value.trim());
  pintarSecciones();
  cargarNoticias();
});

ui.refrescar.addEventListener('click', cargarNoticias);
ui.reintentar.addEventListener('click', cargarNoticias);

// Clic en una sección: limpia la búsqueda y carga ese tema
ui.navSecciones.addEventListener('click', (evento) => {
  const boton = evento.target.closest('.secciones__boton');
  if (!boton) return;
  seccionActual = FUENTES[ui.fuente.value].secciones.find((s) => s.id === boton.dataset.seccion);
  ui.busqueda.value = '';
  pintarSecciones();
  cargarNoticias();
});

ui.fuente.addEventListener('change', () => {
  ui.campoClave.hidden = !FUENTES[ui.fuente.value].requiereClave;
  guardarPreferencia('pulso-fuente', ui.fuente.value);
  pintarSecciones();
  cargarNoticias();
});

ui.auto.addEventListener('change', () => {
  clearInterval(temporizadorAuto);
  if (ui.auto.checked) temporizadorAuto = setInterval(cargarNoticias, INTERVALO_AUTO_MS);
});

// Delegación de eventos: un solo listener para todos los titulares
ui.lista.addEventListener('click', (evento) => {
  const enlace = evento.target.closest('.nota__enlace');
  if (enlace) abrirNoticia(noticiasActuales[Number(enlace.dataset.indice)]);
});

ui.cerrarModal.addEventListener('click', () => ui.modal.close());
ui.modal.addEventListener('click', (evento) => {
  if (evento.target === ui.modal) ui.modal.close(); // clic fuera del contenido
});

window.addEventListener('online', cargarNoticias);

/* ---------- 9. Inicio ---------- */

(function iniciar() {
  const hoy = new Intl.DateTimeFormat('es-MX', { dateStyle: 'full' }).format(new Date());
  ui.fechaHoy.textContent = hoy.charAt(0).toUpperCase() + hoy.slice(1);
  const fuenteGuardada = leerPreferencia('pulso-fuente');
  if (fuenteGuardada && FUENTES[fuenteGuardada]) ui.fuente.value = fuenteGuardada;
  ui.clave.value = leerPreferencia('pulso-clave-gnews') || '';
  ui.campoClave.hidden = !FUENTES[ui.fuente.value].requiereClave;
  pintarSecciones();
  cargarNoticias();
})();
