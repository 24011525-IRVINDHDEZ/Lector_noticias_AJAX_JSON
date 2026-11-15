/* =========================================================
   Infórmese de los Dineros · Lector de noticias
   Reto 5 — Programación web del lado del cliente (UVEG)
   Autor: Irvin Daniel Hernández Márquez

   Flujo general:
   1) El usuario elige una sección o escribe un tema.
   2) obtenerNoticias() pide los datos con fetch() a una o varias APIs.
   3) Cada respuesta JSON se convierte a un formato común.
   4) Se descartan las notas que no vienen de sitios HTTPS.
   5) mostrarNoticias() crea las notas en el DOM.
   6) Si algo falla, mostrarMensaje() explica el problema.
   ========================================================= */

'use strict';

/* ---------- 1. Configuración ---------- */

const TIEMPO_LIMITE_MS = 12000;          // 12 s máximo por petición
const INTERVALO_AUTO_MS = 5 * 60 * 1000; // actualización automática: 5 min
const RSS2JSON = 'https://api.rss2json.com/v1/api.json';

// Medios en español. Su RSS (XML) se convierte a JSON con rss2json.
const MEDIOS = {
  expansionEconomia: { nombre: 'Expansión', rss: 'https://e00-expansion.uecdn.es/rss/economia.xml' },
  expansionEmpresas: { nombre: 'Expansión', rss: 'https://e00-expansion.uecdn.es/rss/empresas.xml' },
  expansionMercados: { nombre: 'Expansión', rss: 'https://e00-expansion.uecdn.es/rss/mercados.xml' },
  elpaisEconomia: { nombre: 'El País', rss: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/economia/portada' },
  elpaisTecnologia: { nombre: 'El País', rss: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/tecnologia/portada' },
  elpaisMexico: { nombre: 'El País México', rss: 'https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/section/mexico/portada' },
  forbesMexico: { nombre: 'Forbes México', rss: 'https://www.forbes.com.mx/feed/' },
  elFinanciero: { nombre: 'El Financiero', rss: 'https://www.elfinanciero.com.mx/arc/outboundfeeds/rss/?outputType=xml' },
  xataka: { nombre: 'Xataka', rss: 'https://www.xataka.com/feedburner.xml' },
};

const FUENTES = {
  medios: {
    nombre: 'Medios en español',
    requiereClave: false,
    secciones: [
      { id: 'portada', etiqueta: 'Portada', medios: ['expansionEconomia', 'elpaisEconomia', 'forbesMexico', 'xataka'] },
      { id: 'mercados', etiqueta: 'Mercados', medios: ['expansionMercados', 'elFinanciero', 'elpaisEconomia'] },
      { id: 'corporaciones', etiqueta: 'Corporaciones', medios: ['expansionEmpresas', 'forbesMexico'] },
      { id: 'tecnologia', etiqueta: 'Tecnología', medios: ['xataka', 'elpaisTecnologia'] },
      { id: 'mexico', etiqueta: 'México', medios: ['elFinanciero', 'forbesMexico', 'elpaisMexico'] },
    ],

    // Una petición por medio. Si hay búsqueda, se consultan todos los medios.
    construirPeticiones({ busqueda, seccion }) {
      const ids = busqueda ? Object.keys(MEDIOS) : seccion.medios;
      return ids.map((id) => {
        const url = new URL(RSS2JSON);
        url.searchParams.set('rss_url', MEDIOS[id].rss);
        return { url, medio: MEDIOS[id].nombre };
      });
    },

    // JSON recibido: { status: "ok", feed: {...}, items: [ {...}, ... ] }
    extraerArticulos(json, medio) {
      if (json.status !== 'ok' || !Array.isArray(json.items)) {
        throw new ErrorNoticias('formato', json.message || 'La respuesta no contiene la lista "items".');
      }
      return json.items.map((a) => ({
        id: a.guid || a.link,
        titulo: a.title,
        resumen: textoPlano(a.description || a.content || ''),
        url: a.link,
        imagen: buscarImagen(a),
        fuente: medio,
        autor: a.author || '',
        fecha: fechaIso(a.pubDate),
      }));
    },

    // RSS no permite buscar: se filtra por palabra clave en el navegador
    filtrarBusqueda: true,
  },

  gnews: {
    nombre: 'GNews',
    requiereClave: true,
    secciones: [
      { id: 'business', etiqueta: 'Negocios' },
      { id: 'technology', etiqueta: 'Tecnología' },
      { id: 'world', etiqueta: 'Mundo' },
      { id: 'nation', etiqueta: 'México' },
    ],

    construirPeticiones({ busqueda, cantidad, clave, seccion }) {
      const ruta = busqueda ? 'search' : 'top-headlines';
      const url = new URL(`https://gnews.io/api/v4/${ruta}`);
      url.searchParams.set('lang', 'es');
      url.searchParams.set('country', 'mx');
      url.searchParams.set('max', Math.min(cantidad, 10)); // el plan gratuito permite 10
      url.searchParams.set('apikey', clave);
      if (busqueda) url.searchParams.set('q', busqueda);
      else url.searchParams.set('category', seccion.id);
      return [{ url, medio: 'GNews' }];
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

    filtrarBusqueda: false,
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
  plantilla: $('plantilla-nota'),
  modal: $('modal-noticia'),
  modalMedio: $('modal-medio'),
  modalImagen: $('modal-imagen'),
  modalMeta: $('modal-meta'),
  modalTitulo: $('modal-titulo'),
  modalResumen: $('modal-resumen'),
  modalEnlace: $('modal-enlace'),
  cerrarModal: $('btn-cerrar-modal'),
};

let controladorActual = null; // permite cancelar las peticiones en curso
let temporizadorAuto = null;
let noticiasActuales = [];
let numeroPeticion = 0;       // identifica la carga más reciente
let seccionActual = null;     // sección elegida en la barra de navegación

/* ---------- 3. Peticiones con Fetch ---------- */

// Hace una petición GET y devuelve el JSON ya convertido a objeto
async function pedirJson(url, controlador) {
  let respuesta;
  try {
    respuesta = await fetch(url, {
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
  }

  // fetch() solo falla por problemas de red; los códigos 4xx/5xx se revisan aquí
  if (!respuesta.ok) {
    throw new ErrorNoticias('http', describirEstadoHttp(respuesta.status));
  }

  try {
    return await respuesta.json(); // convierte el cuerpo de texto JSON a objeto
  } catch {
    throw new ErrorNoticias('formato', 'La API respondió algo que no es JSON válido.');
  }
}

async function obtenerNoticias(parametros) {
  const fuente = FUENTES[parametros.fuente];

  if (fuente.requiereClave && !parametros.clave) {
    throw new ErrorNoticias('clave',
      'GNews necesita una clave gratuita de gnews.io. Pégala en Ajustes o elige «Medios en español».');
  }
  if (!navigator.onLine) {
    throw new ErrorNoticias('red', 'Tu dispositivo no tiene conexión a internet.');
  }

  // Si el usuario pide otra carga antes de que termine la anterior, se cancela
  controladorActual?.abort();
  const controlador = new AbortController();
  controladorActual = controlador;
  const temporizador = setTimeout(() => controlador.abort('tiempo'), TIEMPO_LIMITE_MS);

  const peticiones = fuente.construirPeticiones(parametros);
  let resultados;
  try {
    // Todas las peticiones salen al mismo tiempo; allSettled espera a todas,
    // aunque alguna falle, para mostrar lo que sí llegó.
    resultados = await Promise.allSettled(peticiones.map(async ({ url, medio }) => {
      const json = await pedirJson(url, controlador);
      return fuente.extraerArticulos(json, medio);
    }));
  } finally {
    clearTimeout(temporizador);
  }

  const exitosas = resultados.filter((r) => r.status === 'fulfilled');
  const fallidas = resultados.filter((r) => r.status === 'rejected');
  fallidas.forEach((r) => console.warn('[Dineros] Un medio no respondió:', r.reason));

  if (fallidas.some((r) => r.reason?.name === 'AbortError')) {
    throw new DOMException('Cancelada', 'AbortError');
  }
  if (exitosas.length === 0) throw fallidas[0].reason; // ningún medio respondió

  let noticias = exitosas.flatMap((r) => r.value)
    .filter((n) => n.titulo && esSitioSeguro(n.url)); // solo sitios HTTPS

  if (fuente.filtrarBusqueda && parametros.busqueda) {
    const termino = normalizar(parametros.busqueda);
    noticias = noticias.filter((n) => normalizar(`${n.titulo} ${n.resumen}`).includes(termino));
  }

  noticias = quitarDuplicados(noticias)
    .sort((a, b) => new Date(b.fecha) - new Date(a.fecha)) // más recientes primero
    .slice(0, parametros.cantidad);

  return { noticias, respondieron: exitosas.length, total: resultados.length };
}

function describirEstadoHttp(codigo) {
  const mensajes = {
    400: 'La petición tiene parámetros incorrectos (400).',
    401: 'La clave de la API no es válida (401).',
    403: 'La API negó el acceso; revisa tu clave o plan (403).',
    404: 'No se encontró el recurso solicitado (404).',
    422: 'La API no pudo leer el canal de noticias solicitado (422).',
    426: 'El plan gratuito de la API no permite peticiones desde este dominio (426).',
    429: 'Se alcanzó el límite de peticiones de la API (429). Intenta en unos minutos.',
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
    ? `Resultados para «${parametros.busqueda}»`
    : seccionActual.etiqueta;
  ocultarMensaje();
  mostrarEsqueletos();
  indicarCarga(true);

  try {
    const { noticias, respondieron, total } = await obtenerNoticias(parametros);
    noticiasActuales = noticias;

    if (noticias.length === 0) {
      ui.lista.replaceChildren();
      mostrarMensaje('vacio', 'No hay noticias disponibles',
        parametros.busqueda
          ? `Ninguna nota reciente menciona «${parametros.busqueda}». Prueba con otro tema.`
          : 'Los medios no devolvieron noticias por ahora. Intenta de nuevo más tarde.');
    } else {
      mostrarNoticias(noticias);
    }
    const medios = total > 1 ? ` · ${respondieron} de ${total} medios` : '';
    ui.estado.textContent = `Actualizado a las ${formatearHora(new Date())}${medios}`;
  } catch (error) {
    if (error.name === 'AbortError') return; // la reemplazó una carga más nueva
    console.error('[Dineros]', error);
    ui.lista.replaceChildren();
    mostrarMensaje('error', tituloError(error.tipo), error.message);
    ui.estado.textContent = 'Error al actualizar';
    if (error.tipo === 'clave') {
      ui.clave.closest('details').open = true;
      ui.clave.focus();
    }
  } finally {
    if (miPeticion === numeroPeticion) indicarCarga(false);
  }
}

function tituloError(tipo) {
  return {
    red: 'Sin conexión con las fuentes',
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
    nota.style.animationDelay = `${indice * 40}ms`;

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
    nota.querySelector('.nota__medio').textContent = noticia.fuente;
    const enlace = nota.querySelector('.nota__enlace');
    enlace.textContent = noticia.titulo;
    enlace.dataset.indice = indice;
    nota.querySelector('.nota__resumen').textContent = noticia.resumen || '';
    nota.querySelector('.nota__meta').textContent = tiempoRelativo(noticia.fecha);

    fragmento.append(nota);
  });

  ui.lista.replaceChildren(fragmento);
}

function mostrarEsqueletos() {
  const molde = `
    <div class="esqueleto" aria-hidden="true">
      <div class="esqueleto__linea"></div>
      <div class="esqueleto__linea"></div>
      <div class="esqueleto__linea"></div>
    </div>`;
  ui.lista.innerHTML = molde.repeat(6);
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
  ui.refrescar.setAttribute('aria-disabled', String(cargando));
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

/* Ventana modal para leer la noticia */
function abrirNoticia(noticia) {
  ui.modalImagen.hidden = !noticia.imagen;
  if (noticia.imagen) {
    ui.modalImagen.src = noticia.imagen;
    ui.modalImagen.alt = noticia.titulo;
  }
  const autor = noticia.autor ? `Por ${noticia.autor} · ` : '';
  ui.modalMedio.textContent = noticia.fuente;
  ui.modalTitulo.textContent = noticia.titulo;
  ui.modalMeta.textContent = autor + formatearFecha(noticia.fecha);
  ui.modalResumen.textContent = noticia.resumen || 'Esta noticia no incluye resumen.';
  ui.modalEnlace.href = noticia.url;
  ui.modalEnlace.textContent = `Leer la nota completa en ${dominio(noticia.url)} ↗`;
  ui.modal.showModal();
}

/* ---------- 6. Utilidades ---------- */

// Solo se aceptan enlaces con protocolo HTTPS (conexión cifrada)
function esSitioSeguro(direccion) {
  try { return new URL(direccion).protocol === 'https:'; } catch { return false; }
}

// Busca la imagen de una nota RSS en el orden: miniatura, adjunto, primera <img>
function buscarImagen(item) {
  const candidatas = [item.thumbnail];
  if (!item.enclosure?.type || item.enclosure.type.startsWith('image')) candidatas.push(item.enclosure?.link);
  const html = new DOMParser().parseFromString(`${item.description || ''}${item.content || ''}`, 'text/html');
  candidatas.push(html.querySelector('img')?.getAttribute('src'));
  return candidatas.find((src) => src && esSitioSeguro(src)) || '';
}

// Convierte HTML de la API en texto plano (DOMParser no ejecuta scripts)
function textoPlano(html) {
  const texto = new DOMParser().parseFromString(html, 'text/html').body.textContent;
  return texto.replace(/\s+/g, ' ').trim();
}

// rss2json entrega "2026-11-14 18:05:00" (hora UTC); se pasa a formato ISO
function fechaIso(texto = '') {
  return /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(texto) ? `${texto.replace(' ', 'T')}Z` : texto;
}

function quitarDuplicados(noticias) {
  const vistas = new Set();
  return noticias.filter((n) => !vistas.has(n.url) && vistas.add(n.url));
}

// Minúsculas y sin acentos, para que «tecnologia» encuentre «tecnología»
function normalizar(texto) {
  return texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function dominio(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'el sitio original'; }
}

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
  guardarPreferencia('dineros-clave-gnews', ui.clave.value.trim());
  pintarSecciones();
  cargarNoticias();
});

ui.refrescar.addEventListener('click', () => {
  if (ui.refrescar.getAttribute('aria-disabled') !== 'true') cargarNoticias();
});
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
  guardarPreferencia('dineros-fuente', ui.fuente.value);
  pintarSecciones();
  cargarNoticias();
});

ui.cantidad.addEventListener('change', cargarNoticias);

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
  const fuenteGuardada = leerPreferencia('dineros-fuente');
  if (fuenteGuardada && FUENTES[fuenteGuardada]) ui.fuente.value = fuenteGuardada;
  ui.clave.value = leerPreferencia('dineros-clave-gnews') || '';
  ui.campoClave.hidden = !FUENTES[ui.fuente.value].requiereClave;
  pintarSecciones();
  cargarNoticias();
})();
