/* =========================================================
   Pulso · Lector de noticias
   Reto 5 — Programación web del lado del cliente (UVEG)
   Autor: Irvin Daniel Hernández Márquez

   Flujo general:
   1) El usuario elige fuente, tema y cantidad.
   2) obtenerNoticias() hace la petición con fetch().
   3) La respuesta JSON se convierte a un formato común.
   4) mostrarNoticias() crea las tarjetas en el DOM.
   5) Si algo falla, mostrarMensaje() explica el problema.
   ========================================================= */

'use strict';

/* ---------- 1. Configuración de las APIs ---------- */

const TIEMPO_LIMITE_MS = 10000;          // 10 s máximo por petición
const INTERVALO_AUTO_MS = 5 * 60 * 1000; // actualización automática: 5 min

const FUENTES = {
  spaceflight: {
    nombre: 'Spaceflight News API',
    requiereClave: false,

    construirUrl({ busqueda, cantidad }) {
      const url = new URL('https://api.spaceflightnewsapi.net/v4/articles/');
      url.searchParams.set('limit', cantidad);
      url.searchParams.set('ordering', '-published_at');
      if (busqueda) url.searchParams.set('search', busqueda);
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

    construirUrl({ busqueda, cantidad, clave }) {
      const ruta = busqueda ? 'search' : 'top-headlines';
      const url = new URL(`https://gnews.io/api/v4/${ruta}`);
      url.searchParams.set('lang', 'es');
      url.searchParams.set('country', 'mx');
      url.searchParams.set('max', Math.min(cantidad, 10)); // el plan gratuito permite 10
      url.searchParams.set('apikey', clave);
      if (busqueda) url.searchParams.set('q', busqueda);
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
  estado: $('estado-actualizacion'),
  lista: $('lista-noticias'),
  mensaje: $('mensaje'),
  mensajeIcono: $('mensaje-icono'),
  mensajeTitulo: $('mensaje-titulo'),
  mensajeTexto: $('mensaje-texto'),
  plantilla: $('plantilla-tarjeta'),
  modal: $('modal-noticia'),
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
let numeroPeticion = 0; // identifica la petición más reciente

/* ---------- 3. Petición con Fetch ---------- */

async function obtenerNoticias(parametros) {
  const fuente = FUENTES[parametros.fuente];

  if (fuente.requiereClave && !parametros.clave) {
    throw new ErrorNoticias('clave', 'Escribe tu clave de GNews para usar esta fuente.');
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
  };

  const miPeticion = ++numeroPeticion;
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
          ? `No se encontraron noticias sobre "${parametros.busqueda}". Prueba con otro tema.`
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
    const tarjeta = ui.plantilla.content.firstElementChild.cloneNode(true);
    if (indice === 0) tarjeta.classList.add('tarjeta--destacada');
    tarjeta.style.animationDelay = `${indice * 60}ms`;

    const img = tarjeta.querySelector('.tarjeta__imagen');
    if (noticia.imagen) {
      img.src = noticia.imagen;
      img.alt = noticia.titulo;
      img.addEventListener('error', () => img.remove()); // imagen rota → se queda el degradado
    } else {
      img.remove();
    }

    // textContent evita inyectar HTML ajeno (protección contra XSS)
    tarjeta.querySelector('.tarjeta__meta').textContent =
      `${noticia.fuente} · ${tiempoRelativo(noticia.fecha)}`;
    const enlace = tarjeta.querySelector('.tarjeta__enlace');
    enlace.textContent = noticia.titulo;
    enlace.dataset.indice = indice;
    tarjeta.querySelector('.tarjeta__resumen').textContent = noticia.resumen || '';

    fragmento.append(tarjeta);
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
  ui.lista.innerHTML = molde.repeat(cantidad);
}

function mostrarMensaje(tipo, titulo, texto) {
  ui.mensaje.classList.toggle('mensaje--vacio', tipo === 'vacio');
  ui.mensajeIcono.textContent = tipo === 'vacio' ? '☰' : '⚠';
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

/* Ventana modal para leer la noticia completa */
function abrirNoticia(noticia) {
  ui.modalImagen.hidden = !noticia.imagen;
  if (noticia.imagen) {
    ui.modalImagen.src = noticia.imagen;
    ui.modalImagen.alt = noticia.titulo;
  }
  const autor = noticia.autor ? ` · ${noticia.autor}` : '';
  ui.modalMeta.textContent = `${noticia.fuente} · ${formatearFecha(noticia.fecha)}${autor}`;
  ui.modalTitulo.textContent = noticia.titulo;
  ui.modalResumen.textContent = noticia.resumen || 'Esta noticia no incluye resumen.';
  ui.modalEnlace.href = noticia.url;
  ui.modal.showModal();
}

/* ---------- 6. Utilidades de fecha (formato es-MX) ---------- */

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
  cargarNoticias();
});

ui.refrescar.addEventListener('click', cargarNoticias);
ui.reintentar.addEventListener('click', cargarNoticias);

ui.fuente.addEventListener('change', () => {
  ui.campoClave.hidden = !FUENTES[ui.fuente.value].requiereClave;
  guardarPreferencia('pulso-fuente', ui.fuente.value);
  cargarNoticias();
});

ui.clave.addEventListener('change', () => guardarPreferencia('pulso-clave-gnews', ui.clave.value.trim()));

ui.auto.addEventListener('change', () => {
  clearInterval(temporizadorAuto);
  if (ui.auto.checked) temporizadorAuto = setInterval(cargarNoticias, INTERVALO_AUTO_MS);
});

// Delegación de eventos: un solo listener para todos los títulos
ui.lista.addEventListener('click', (evento) => {
  const enlace = evento.target.closest('.tarjeta__enlace');
  if (enlace) abrirNoticia(noticiasActuales[Number(enlace.dataset.indice)]);
});

ui.cerrarModal.addEventListener('click', () => ui.modal.close());
ui.modal.addEventListener('click', (evento) => {
  if (evento.target === ui.modal) ui.modal.close(); // clic fuera del contenido
});

window.addEventListener('online', cargarNoticias);

/* ---------- 9. Inicio ---------- */

(function iniciar() {
  const fuenteGuardada = leerPreferencia('pulso-fuente');
  if (fuenteGuardada && FUENTES[fuenteGuardada]) ui.fuente.value = fuenteGuardada;
  ui.clave.value = leerPreferencia('pulso-clave-gnews') || '';
  ui.campoClave.hidden = !FUENTES[ui.fuente.value].requiereClave;
  cargarNoticias();
})();
