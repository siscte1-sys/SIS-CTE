/* ══════════════════════════════════════════════════════════
   PORTAL SISCTE — app.js  v4.0
   ─ Almacenamiento: todos los archivos → Google Drive
     (carpeta por área, se crea automáticamente)
   ─ Firestore: solo guarda metadatos (nombre, área, fecha…)
   ─ EmailJS para correo de confirmación al usuario
   ─ PDF comprobante descargado automáticamente al enviar
   ─ Panel admin con filtros y exportación Excel filtrada
══════════════════════════════════════════════════════════ */

/* ══════════════════════════════════════════════════════════
   SOLUCIÓN AL ERROR CORS EN GITHUB PAGES
   ──────────────────────────────────────────────────────────
   Si ves "Access blocked by CORS policy" en Firebase Storage,
   ejecuta ESTOS PASOS UNA SOLA VEZ desde tu PC:

   1. Instala Google Cloud SDK: https://cloud.google.com/sdk/docs/install
   2. Crea un archivo cors.json con este contenido exacto:
      [{"origin":["https://siscte1-sys.github.io","http://localhost"],
        "method":["GET","POST","PUT","DELETE","HEAD"],
        "maxAgeSeconds":3600}]
   3. Ejecuta en terminal:
      gcloud auth login
      gsutil cors set cors.json gs://siscte-30f1b.firebasestorage.app
   4. Verifica con:
      gsutil cors get gs://siscte-30f1b.firebasestorage.app

   MIENTRAS TANTO: el sistema usa Firestore comprimido
   automáticamente para archivos hasta 800 KB.
   Para archivos más grandes: arregla CORS primero.
══════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDPgK1CBF0sO00j6Rho_e9xkc9Xj2HdPaI",
  authDomain:        "sis-cte1.firebaseapp.com",
  projectId:         "sis-cte1",
  storageBucket:     "sis-cte1.firebasestorage.app",
  messagingSenderId: "861145504172",
  appId:             "1:861145504172:web:daa073aec7e6478709c209"
};

/* ── EMAILJS ─────────────────────────────────────────────
   Misma cuenta de notificaciones compartida
──────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey:  "gaScEoguCEcx7aFYT",
  serviceId:  "service_ybvnh3i",
  templateId: "template_8d6u82j"
};

/* Google Drive API — todos los archivos se suben aquí */
const GDRIVE_CONFIG = {
  clientId: '861145504172-qf14jcon0msi3hl3l5cn5j5eard2gdvb.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive'
};

/* ID de la carpeta raíz GENERAL en Google Drive */
const GDRIVE_ROOT_FOLDER_ID = '1EBYsTtNi7JMTOYqKSnjFWnipmaq1L_LU';

const ADMIN_EMAILS = [
  "sis.cte1@gmail.com"
];

const AREAS = [
  "ZONA 5","ZONA 6",
  "CEBAF TULCAN","CEBAF NUEVA LOJA","CEBAF HUAQUILLAS",
  "CEBAF MACARA","CEBAF AREA COMPUTO NACIONAL",
  "PROV_PICHINCHA","PROV_MANABI","PROV_SANTO DOMINGO",
  "PROV_LOS RIOS","PROV_BOLIVAR","PROV_SANTA ELENA",
  "PROV_AZUAY","PROV_EL ORO",
  "UREM","OIAT","EDU_VIAL","CRV","ECU-911"
];

let db, auth, usuario = null;
let archivoSeleccionado = null;
let docsAdmin = [];
let _firebaseReady = null; // Promesa que resuelve cuando Firebase está listo

/* ══════════════════════════════════
   FIREBASE INIT
══════════════════════════════════ */
let _resolveFirebase;
_firebaseReady = new Promise(res => { _resolveFirebase = res; });

async function initFirebase() {
  const { initializeApp }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
  const { getFirestore, collection, addDoc, getDocs, orderBy, query, doc, getDoc }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    sendPasswordResetEmail, updateProfile }
    = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

  const app = initializeApp(FIREBASE_CONFIG);
  db   = getFirestore(app);
  auth = getAuth(app);

  window._fb = {
    collection, addDoc, getDocs, orderBy, query, doc, getDoc,
    GoogleAuthProvider, signInWithPopup, signInWithRedirect,
    getRedirectResult, signOut, onAuthStateChanged,
    createUserWithEmailAndPassword, signInWithEmailAndPassword,
    sendPasswordResetEmail, updateProfile
  };

  // Capturar resultado del redirect de Google si viene de uno
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) console.log('Redirect login OK:', result.user.email);
  } catch(e) { console.warn('Redirect result:', e.message); }

  onAuthStateChanged(auth, u => {
    if (u) {
      usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
      actualizarNav();
      esAdmin() ? show('nb-subir') : hide('nb-subir');
      esAdmin() ? show('nb-admin') : hide('nb-admin');
      irSubir();
    } else {
      usuario = null;
      actualizarNav();
      ir('vista-login');
    }
  });

  _resolveFirebase(); // Firebase listo — desbloquear login
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
async function login() {
  try {
    await _firebaseReady; // Esperar a que Firebase esté completamente cargado
    const provider = new window._fb.GoogleAuthProvider();
    try {
      // Intentar popup primero (más rápido)
      await window._fb.signInWithPopup(auth, provider);
    } catch(popupErr) {
      // Si el popup falla (bloqueado por navegador), usar redirect
      if (popupErr.code === 'auth/popup-blocked' ||
          popupErr.code === 'auth/popup-closed-by-user' ||
          popupErr.code === 'auth/cancelled-popup-request') {
        await window._fb.signInWithRedirect(auth, provider);
      } else {
        throw popupErr;
      }
    }
  } catch(e) {
    if (e.code !== 'auth/popup-closed-by-user' &&
        e.code !== 'auth/cancelled-popup-request') {
      toast('Error al iniciar sesión: ' + (e.message || e.code), 'err');
    }
  }
}

async function logout() {
  // Limpiar caché del token de Drive al cerrar sesión
  _driveTokenCache  = null;
  _driveTokenExpiry = 0;
  try { await window._fb.signOut(auth); } catch(e) {}
}

async function loginEmail() {
  await _firebaseReady;
  const email = document.getElementById('login-email')?.value?.trim();
  const pass  = document.getElementById('login-pass')?.value;
  if (!email || !pass) { toast('Ingresa correo y contraseña','err'); return; }
  try {
    const cred = await window._fb.signInWithEmailAndPassword(auth, email, pass);
    await cred.user.reload();
  } catch(e) {
    const msg = e.code === 'auth/invalid-credential' ? 'Correo o contraseña incorrectos'
              : e.code === 'auth/user-not-found'     ? 'No existe una cuenta con ese correo'
              : e.code === 'auth/wrong-password'     ? 'Contraseña incorrecta'
              : 'Error: ' + e.message;
    toast(msg, 'err');
  }
}

async function registrarEmail() {
  await _firebaseReady;
  const nombre = document.getElementById('reg-nombre')?.value?.trim();
  const email  = document.getElementById('reg-email')?.value?.trim();
  const pass   = document.getElementById('reg-pass')?.value;
  if (!nombre) { toast('Ingresa tu nombre completo','err'); return; }
  if (!email)  { toast('Ingresa tu correo','err'); return; }
  if (!pass || pass.length < 6) { toast('La contraseña debe tener al menos 6 caracteres','err'); return; }
  try {
    const cred = await window._fb.createUserWithEmailAndPassword(auth, email, pass);
    await window._fb.updateProfile(cred.user, { displayName: nombre });
    await cred.user.reload();
    usuario = { uid: cred.user.uid, nombre: nombre, email: cred.user.email, foto: cred.user.photoURL };
    actualizarNav();
    toast('Cuenta creada exitosamente');
  } catch(e) {
    const msg = e.code === 'auth/email-already-in-use' ? 'Ya existe una cuenta con ese correo'
              : e.code === 'auth/invalid-email'        ? 'Correo no válido'
              : e.code === 'auth/weak-password'        ? 'La contraseña es muy débil'
              : 'Error: ' + e.message;
    toast(msg, 'err');
  }
}

async function olvidoContrasena() {
  const email = document.getElementById('login-email')?.value?.trim();
  if (!email) { toast('Ingresa primero tu correo en el campo de arriba','err'); return; }
  try {
    await window._fb.sendPasswordResetEmail(auth, email);
    toast('Correo de recuperación enviado — revisa tu bandeja ✓');
  } catch(e) {
    toast('No se encontró una cuenta con ese correo','err');
  }
}

window.switchTab = function(tab) {
  document.getElementById('panel-login').style.display    = tab==='login'    ? 'block' : 'none';
  document.getElementById('panel-registro').style.display = tab==='registro' ? 'block' : 'none';
  document.getElementById('tab-login').classList.toggle('active',    tab==='login');
  document.getElementById('tab-registro').classList.toggle('active', tab==='registro');
};

const esAdmin = () =>
  usuario && ADMIN_EMAILS.map(x => x.toLowerCase()).includes(usuario.email.toLowerCase());

/* ══════════════════════════════════
   DOM HELPERS
══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(e) e.style.display='block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none'; };
const hideAll = () => ['vista-login','vista-subir','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll(); 
  // vista-login necesita flex para centrado, las demás usan block
  const el = $(v);
  if (!el) return;
  el.style.display = (v === 'vista-login') ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-subir'||v==='vista-exito') $('nb-subir')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function toast(msg, tipo='ok') {
  const t = $('toast');
  t.textContent = msg;
  t.className = `toast toast--${tipo} toast--on`;
  clearTimeout(t._t);
  t._t = setTimeout(() => t.className = 'toast', 4200);
}

function actualizarNav() {
  if (usuario) {
    const fotoEl = $('nav-foto');
    if (usuario.foto) {
      fotoEl.src = usuario.foto;
      fotoEl.style.display = 'block';
      const initEl = $('nav-iniciales');
      if (initEl) initEl.style.display = 'none';
    } else {
      fotoEl.style.display = 'none';
      let initEl = $('nav-iniciales');
      if (!initEl) {
        initEl = document.createElement('div');
        initEl.id = 'nav-iniciales';
        initEl.style.cssText = 'width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        fotoEl.parentNode.insertBefore(initEl, fotoEl.nextSibling);
      }
      const nombre = usuario.nombre || usuario.email || '?';
      const partes = nombre.trim().split(' ');
      initEl.textContent = partes.length >= 2
        ? (partes[0][0] + partes[1][0]).toUpperCase()
        : nombre.slice(0,2).toUpperCase();
      initEl.style.display = 'flex';
    }
    $('nav-nombre').textContent = usuario.nombre?.split(' ')[0] || usuario.email;
    show('nav-sesion'); hide('nav-guest');
    esAdmin() ? show('nb-subir') : hide('nb-subir');
    esAdmin() ? show('nb-admin') : hide('nb-admin');
  } else {
    hide('nav-sesion'); show('nav-guest'); hide('nb-admin');
  }
}

function resetBtn() {
  const btn = $('btn-enviar');
  if (!btn) return;
  btn.disabled = false;
  btn.innerHTML = `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
      stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
      <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg> Registrar Envío`;
}

/* ══════════════════════════════════
   AREAS
══════════════════════════════════ */
function poblarAreas(selectId, placeholder='— Selecciona tu área —') {
  const sel = $(selectId);
  if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  AREAS.forEach(a => {
    const opt = document.createElement('option');
    opt.value = a; opt.textContent = a;
    sel.appendChild(opt);
  });
}

/* ══════════════════════════════════
   VISTA SUBIR
══════════════════════════════════ */
function irSubir() {
  // Limpiar estado del archivo
  archivoSeleccionado = null;

  // CRÍTICO: resetear el input file para que el evento change
  // se dispare incluso si el usuario selecciona el mismo archivo
  const fi = $('file-input');
  if (fi) fi.value = '';

  // Limpiar UI del formulario
  $('dropzone').style.display    = 'flex';
  $('file-preview').style.display = 'none';
  $('progress-wrap').style.display = 'none';
  $('area-select').value = '';
  const det = $('detalle-envio'); if (det) det.value = '';

  // Limpiar barra de progreso
  const bar = $('progress-bar');
  if (bar) bar.style.width = '0%';
  const ptxt = $('progress-txt');
  if (ptxt) ptxt.textContent = '0%';

  resetBtn();

  const heroNombre = $('hero-nombre');
  if (heroNombre) heroNombre.textContent = usuario?.nombre || usuario?.email || '';

  ir('vista-subir');
  cargarMisEnvios();
}

/* ══════════════════════════════════
   MIS ENVÍOS — historial personal
══════════════════════════════════ */
async function cargarMisEnvios() {
  const lista = $('mis-envios-lista');
  if (!lista || !usuario) return;
  lista.innerHTML = `<div class="mis-envios-vacio"><p style="font-size:12px;color:var(--txt3);">Cargando tus envíos...</p></div>`;
  try {
    const { where } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q = window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid','==',usuario.uid)
    );
    const snap = await window._fb.getDocs(q);
    const docs = snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    if (docs.length === 0) {
      lista.innerHTML = `
        <div class="mis-envios-vacio">
          <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
          <p>No hay envíos registrados todavía.</p>
        </div>`;
      return;
    }
    lista.innerHTML = docs.map(d=>`
      <div class="mis-envio-item${d.archivado?' mei-archivado':''}" id="mei-${d.id}">
        <div class="mei-ico">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        </div>
        <div class="mei-info">
          <div class="mei-nombre">${d.nombreArchivo}</div>
          <div class="mei-meta">
            <span class="mei-area">${d.area||'—'}</span>
            &nbsp;·&nbsp;${d.fechaTexto} · ${d.horaTexto}
            &nbsp;·&nbsp;${d.tamanoTexto||'—'}
            ${d.archivado
              ? '&nbsp;·&nbsp;<span style="color:var(--txt3);font-size:10px;font-weight:600;">Archivado</span>'
              : '&nbsp;·&nbsp;<span style="color:var(--blue);font-size:10px;font-weight:500;" title="Para reemplazar este archivo, sube uno nuevo con el mismo nombre">↩ Para reemplazar, sube el mismo nombre</span>'
            }
          </div>
        </div>
      </div>`).join('');
  } catch(e) {
    lista.innerHTML = `<div class="mis-envios-vacio"><p style="color:var(--red);font-size:11px;">Error: ${e.message}</p></div>`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  poblarAreas('area-select');
  poblarAreas('filtro-area', 'Todas las áreas');

  $('btn-google').addEventListener('click', login);
  document.getElementById('btn-login-email')?.addEventListener('click', loginEmail);
  document.getElementById('btn-registrar')?.addEventListener('click', registrarEmail);
  document.getElementById('btn-forgot')?.addEventListener('click', olvidoContrasena);
  document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', logout));
  $('nb-subir').addEventListener('click', () => usuario ? irSubir() : ir('vista-login'));
  $('nb-admin').addEventListener('click', () => { if(esAdmin()){ ir('vista-admin'); cargarAdmin(); } });
  $('btn-enviar-otro').addEventListener('click', irSubir);

  const dz = $('dropzone');
  dz.addEventListener('dragover', e => { e.preventDefault(); dz.classList.add('dz-over'); });
  dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
  dz.addEventListener('drop', e => {
    e.preventDefault(); dz.classList.remove('dz-over');
    if (e.dataTransfer.files[0]) seleccionar(e.dataTransfer.files[0]);
  });
  dz.addEventListener('click', abrirSelectorArchivo);
  $('file-input').addEventListener('change', () => {
    if ($('file-input').files[0]) seleccionar($('file-input').files[0]);
  });
  $('btn-cambiar').addEventListener('click', () => {
    archivoSeleccionado = null;
    $('file-preview').style.display = 'none';
    $('dropzone').style.display = 'flex';
    const fi = $('file-input'); if (fi) fi.value = '';
  });
  $('btn-enviar').addEventListener('click', enviarArchivo);
  $('btn-filtrar').addEventListener('click', aplicarFiltros);
  $('btn-limpiar').addEventListener('click', limpiarFiltros);
  $('btn-excel').addEventListener('click', () => exportarExcel(docsAdmin, false));
  $('btn-excel-filtrado').addEventListener('click', exportarFiltrado);
});

/* ── VALIDACIÓN ── */

/* Crea un input file nuevo cada vez que se abre el selector.
   Esto garantiza que el evento change se dispare siempre,
   incluso si el usuario elige el mismo archivo que antes. */
function abrirSelectorArchivo() {
  const input = document.createElement('input');
  input.type   = 'file';
  input.accept = '.xlsx,.xls';
  input.style.display = 'none';
  input.addEventListener('change', () => {
    if (input.files[0]) seleccionar(input.files[0]);
    input.remove();
  });
  document.body.appendChild(input);
  input.click();
}
function seleccionar(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!['xlsx','xls'].includes(ext)) {
    toast('Solo se aceptan archivos Excel (.xlsx o .xls)', 'err'); return;
  }
  archivoSeleccionado = f;
  $('fp-nombre').textContent = f.name;
  $('fp-peso').textContent   = formatSize(f.size);
  const modoEl = $('fp-modo');
  if (modoEl) modoEl.textContent = '☁️ Google Drive';
  $('dropzone').style.display     = 'none';
  $('file-preview').style.display = 'flex';
}

function formatSize(bytes) {
  if (bytes >= 1024*1024) return (bytes/(1024*1024)).toFixed(2)+' MB';
  return (bytes/1024).toFixed(1)+' KB';
}

function fileToArrayBuffer(file) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsArrayBuffer(file);
  });
}

function arrayBufferToBase64(buf) {
  let binary = '';
  const bytes = new Uint8Array(buf instanceof ArrayBuffer ? buf : buf.buffer);
  const chunk = 8192;
  for (let i = 0; i < bytes.length; i += chunk)
    binary += String.fromCharCode(...bytes.subarray(i, i+chunk));
  return btoa(binary);
}

function setProgreso(pct, label) {
  $('progress-bar').style.width = pct+'%';
  $('progress-txt').textContent = pct+'%';
  const lbl = $('progress-label-txt');
  if (lbl) lbl.textContent = label||'';
}

/* ══════════════════════════════════
   GOOGLE DRIVE UPLOAD
   — Carpeta general: ORGANICO-CTE (ID fijo)
   — Subcarpetas por área: se crean solo la primera vez,
     las siguientes subidas van directo a la existente
══════════════════════════════════ */

/* ID fijo de tu carpeta ORGANICO-CTE en Google Drive */
const GDRIVE_CARPETA_GENERAL = '13LoEmlvtaspZQp6Y7wcEs2Qdhx4ZK1hw';

/* Caché del token con expiración — evita pedir autorización
   en cada envío pero renueva si ha pasado más de 45 minutos */
let _driveTokenCache = null;
let _driveTokenExpiry = 0;

/* Obtener token OAuth2 usando Google Identity Services */
function obtenerTokenDrive(forzarNuevo = false) {
  // Si hay token válido en caché y no forzamos renovación, reutilizarlo
  if (!forzarNuevo && _driveTokenCache && Date.now() < _driveTokenExpiry) {
    return Promise.resolve(_driveTokenCache);
  }

  return new Promise((resolve, reject) => {
    const cargarGIS = () => new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) { res(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });

    cargarGIS().then(() => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GDRIVE_CONFIG.clientId,
        scope: GDRIVE_CONFIG.scope,
        callback: (resp) => {
          if (resp.error) {
            reject(new Error('Error de autorización: ' + resp.error));
          } else {
            // Guardar en caché por 45 minutos (tokens duran 1h)
            _driveTokenCache  = resp.access_token;
            _driveTokenExpiry = Date.now() + 45 * 60 * 1000;
            resolve(resp.access_token);
          }
        }
      });
      client.requestAccessToken();
    }).catch(() => reject(new Error('No se pudo cargar Google Identity Services. Verifica tu conexión.')));
  });
}

/* Busca la subcarpeta del área dentro de ORGANICO-CTE.
   Si no existe todavía, la crea UNA SOLA VEZ y le da
   permiso automático "anyone with link" para que sea
   accesible directamente desde el portal. */
async function obtenerOCrearSubcarpeta(token, nombreArea) {
  // ── 1. Buscar si ya existe ──
  const query = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${nombreArea}' and '${GDRIVE_CARPETA_GENERAL}' in parents and trashed=false`
  );
  const res = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${query}&fields=files(id,name)`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  if (!res.ok) throw new Error('Error buscando subcarpeta: ' + res.status);
  const data = await res.json();

  // Si ya existe → devolver su ID directo, sin crear ni tocar nada
  if (data.files && data.files.length > 0) {
    return data.files[0].id;
  }

  // ── 2. Primera vez: crear la subcarpeta ──
  const crear = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name:     nombreArea,
      mimeType: 'application/vnd.google-apps.folder',
      parents:  [GDRIVE_CARPETA_GENERAL]
    })
  });
  if (!crear.ok) throw new Error('Error creando subcarpeta: ' + crear.status);
  const carpeta = await crear.json();

  // ── 3. Dar permiso automático "anyone with link" (reader) ──
  //    Así cualquier persona con el enlace puede ver/descargar
  //    sin necesidad de que el admin lo comparta manualmente.
  try {
    await fetch(`https://www.googleapis.com/drive/v3/files/${carpeta.id}/permissions`, {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + token,
        'Content-Type':  'application/json'
      },
      body: JSON.stringify({
        role: 'reader',
        type: 'anyone'
      })
    });
    toast(`📁 Carpeta "${nombreArea}" creada y autorizada ✓`);
  } catch(e) {
    // No es crítico si falla el permiso, el archivo igual se sube
    console.warn('No se pudo asignar permiso automático a la carpeta:', e.message);
  }

  return carpeta.id;
}

/* Sube el archivo a ORGANICO-CTE → subcarpeta del área */
async function subirAGoogleDrive(archivo, onProgress) {
  const token = await obtenerTokenDrive();
  const area  = document.getElementById('area-select')?.value || 'SIN_AREA';
  const fecha = new Date().toISOString().slice(0, 10);

  onProgress(15);

  // Obtener o crear (solo primera vez) la subcarpeta del área
  const idSubcarpeta = await obtenerOCrearSubcarpeta(token, area);

  onProgress(30);

  return new Promise((resolve, reject) => {
    const metadata = {
      name: `${fecha}_${archivo.name}`,
      mimeType: archivo.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      parents: [idSubcarpeta]
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', archivo);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        const p = Math.round(30 + (e.loaded / e.total) * 60);
        onProgress(p);
      }
    };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        // Dar acceso de lectura a cualquiera con el link
        fetch(`https://www.googleapis.com/drive/v3/files/${resp.id}/permissions`, {
          method: 'POST',
          headers: {
            'Authorization': 'Bearer ' + token,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ role: 'reader', type: 'anyone' })
        }).then(() => {
          resolve(`https://drive.google.com/file/d/${resp.id}/view`);
        }).catch(() => {
          resolve(resp.webViewLink || `https://drive.google.com/file/d/${resp.id}/view`);
        });
      } else {
        const msg = (() => { try { return JSON.parse(xhr.responseText)?.error?.message; } catch(e) { return xhr.responseText; } })();
        reject(new Error('Error subiendo a Google Drive: ' + (msg || xhr.status)));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red al subir a Google Drive'));
    xhr.send(form);
  });
}

/* ══════════════════════════════════
   ENVIAR ARCHIVO — ESTRATEGIA DUAL
══════════════════════════════════ */
async function enviarArchivo() {
  if (!archivoSeleccionado){ toast('Selecciona un archivo primero','err'); return; }
  const areaVal = $('area-select').value;
  if (!areaVal){ toast('Debes seleccionar tu área antes de enviar','err'); return; }
  const detalleVal = ($('detalle-envio')?.value||'').trim();

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Subiendo...';
  $('progress-wrap').style.display = 'block';
  setProgreso(5, 'Preparando...');

  try {
    const ahora      = new Date();
    const fechaTexto = ahora.toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'});
    const horaTexto  = ahora.toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',second:'2-digit'});

    let storageURL = null;

    /* ─ Todos los archivos van a Google Drive ─ */
    setProgreso(20, 'Conectando con Google Drive...');
    storageURL = await subirAGoogleDrive(archivoSeleccionado, (p) => {
      setProgreso(20 + Math.round(p * 0.6), `Subiendo a Drive... ${p}%`);
    });

    setProgreso(80,'Registrando en Firestore...');

    // ── Detectar si ya existe un archivo con el mismo nombre y área (reemplazo) ──
    const { where, deleteDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const qDup = window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid',          '==', usuario.uid),
      where('nombreArchivo','==', archivoSeleccionado.name),
      where('area',         '==', areaVal)
    );
    const snapDup = await window._fb.getDocs(qDup);
    // Eliminar los duplicados anteriores (mismo nombre + misma área)
    for (const docSnap of snapDup.docs) {
      await deleteDoc(docRef(db,'entregas', docSnap.id));
    }
    const fueReemplazo = snapDup.docs.length > 0;

    await window._fb.addDoc(window._fb.collection(db,'entregas'),{
      uid:           usuario.uid,
      nombre:        usuario.nombre,
      email:         usuario.email,
      foto:          usuario.foto,
      area:          areaVal,
      nombreArchivo: archivoSeleccionado.name,
      tamanoBytes:   archivoSeleccionado.size,
      tamanoTexto:   formatSize(archivoSeleccionado.size),
      metodo:        'google_drive',
      storageURL,
      detalle:       detalleVal,
      fechaTexto,
      horaTexto,
      timestamp:     ahora.toISOString()
    });

    setProgreso(100, fueReemplazo ? '¡Archivo reemplazado!' : '¡Completado!');
    mostrarExito(areaVal, fechaTexto, horaTexto);

    const numRegistro = 'SISCTE-' + Date.now().toString(36).toUpperCase();

    generarComprobantePDF({
      nombre:   usuario.nombre,
      email:    usuario.email,
      area:     areaVal,
      archivo:  archivoSeleccionado.name,
      tamano:   formatSize(archivoSeleccionado.size),
      fecha:    fechaTexto,
      hora:     horaTexto,
      registro: numRegistro
    });

    enviarCorreoNotificacion({
      nombre:   usuario.nombre,
      email:    usuario.email,
      area:     areaVal,
      archivo:  archivoSeleccionado.name,
      tamano:   formatSize(archivoSeleccionado.size),
      fecha:    fechaTexto,
      hora:     horaTexto,
      registro: numRegistro
    });
    setTimeout(() => ir('vista-exito'), 500);

  } catch(err) {
    console.error(err);
    const msg = err?.message || (typeof err === 'string' ? err : 'Error desconocido al subir');
    toast('Error al subir: ' + msg, 'err');
    $('progress-wrap').style.display='none';
    resetBtn();
  }
}

function mostrarExito(area, fecha, hora) {
  $('ex-nombre').textContent  = usuario.nombre;
  $('ex-email').textContent   = usuario.email;
  $('ex-area').textContent    = area;
  $('ex-archivo').textContent = archivoSeleccionado.name;
  $('ex-tamano').textContent  = formatSize(archivoSeleccionado.size);
  $('ex-fecha').textContent   = fecha;
  $('ex-hora').textContent    = hora;
}

/* ══════════════════════════════════
   COMPROBANTE PDF — se descarga
   automáticamente al enviar
══════════════════════════════════ */
async function generarComprobantePDF(d) {
  try {
    if (!window.jspdf) {
      await new Promise((res, rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload = res; s.onerror = rej;
        document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'a4' });
    const W = 210;

    // ── Header azul ──
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, W, 42, 'F');

    // Ícono: cuadrado blanco con letra S en azul (sin Unicode)
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 9, 24, 24, 5, 5, 'F');
    doc.setTextColor(37, 99, 235);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text('S', 22, 25);

    // Línea decorativa azul oscuro dentro del ícono
    doc.setFillColor(29, 78, 216);
    doc.rect(14, 30, 24, 3, 'F');

    // Título
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('SISCTE - Comprobante de Envio', 44, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Gestion de Documentos Excel', 44, 28);
    doc.text('Este documento certifica el registro exitoso de tu archivo.', 44, 35);

    // ── Badge verde "REGISTRADO" ──
    doc.setFillColor(22, 163, 74);
    doc.roundedRect(14, 50, 52, 11, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('REGISTRADO', 19, 57.5);

    // N° de registro
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('No. de Registro: ' + d.registro, 70, 57);

    // ── Seccion datos ──
    const campos = [
      ['Enviado por',  d.nombre],
      ['Correo',       d.email],
      ['Area',         d.area],
      ['Archivo',      d.archivo],
      ['Tamano',       d.tamano],
      ['Fecha',        d.fecha],
      ['Hora',         d.hora],
      ['Almacenamiento', 'Google Drive'],
    ];

    let y = 72;
    campos.forEach(([lbl, val], i) => {
      if (i % 2 === 0) {
        doc.setFillColor(243, 244, 246);
        doc.rect(14, y - 5, W - 28, 10, 'F');
      }
      doc.setTextColor(107, 114, 128);
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold');
      doc.text(lbl.toUpperCase(), 18, y);
      doc.setTextColor(17, 24, 39);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      const valStr = String(val || '-');
      doc.text(valStr.length > 60 ? valStr.substring(0,57)+'...' : valStr, 70, y);
      y += 12;
    });

    // ── Linea separadora ──
    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(14, y + 2, W - 14, y + 2);

    // ── Nota final ──
    y += 10;
    doc.setFillColor(239, 246, 255);
    doc.roundedRect(14, y, W - 28, 18, 3, 3, 'F');
    doc.setTextColor(37, 99, 235);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'bold');
    doc.text('INFORMACION', 18, y + 7);
    doc.setFont('helvetica', 'normal');
    doc.setTextColor(30, 64, 175);
    doc.text('Guarda este comprobante como respaldo de tu entrega. El archivo fue', 18, y + 12);
    doc.text('almacenado en Google Drive y el registro queda permanente en el sistema.', 18, y + 16);

    // ── Footer ──
    doc.setFillColor(37, 99, 235);
    doc.rect(0, 280, W, 17, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema SISCTE - Generado el ' + d.fecha + ' a las ' + d.hora, 14, 291);
    doc.text('siscte1-sys.github.io/SIS-CTE', W - 14, 291, { align: 'right' });

    doc.save('Comprobante_SISCTE_' + d.registro + '.pdf');
    toast('Comprobante PDF descargado');
  } catch(e) {
    console.warn('PDF error:', e.message);
  }
}

/* ══════════════════════════════════
   EMAILJS
══════════════════════════════════ */
async function enviarCorreoNotificacion(datos) {
  try {
    if (!window.emailjs) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
        s.onload=res; s.onerror=rej;
        document.head.appendChild(s);
      });
      emailjs.init(EMAILJS_CONFIG.publicKey);
    }
    await emailjs.send(EMAILJS_CONFIG.serviceId, EMAILJS_CONFIG.templateId, {
      to_email: datos.email,
      to_name:  datos.nombre,
      area:     datos.area,
      archivo:  datos.archivo,
      tamano:   datos.tamano,
      fecha:    datos.fecha,
      hora:     datos.hora,
      registro: datos.registro
    });
    toast('Correo de confirmación enviado ✓');
  } catch(e) {
    console.warn('EmailJS:', e.message||e);
  }
}

/* ══════════════════════════════════
   PANEL ADMIN
══════════════════════════════════ */
async function cargarAdmin() {
  $('tabla-body').innerHTML     = `<tr><td colspan="7" class="td-vacio">Cargando...</td></tr>`;
  $('admin-personas').innerHTML = `<p class="cargando-txt">Cargando...</p>`;

  try {
    const q    = window._fb.query(window._fb.collection(db,'entregas'), window._fb.orderBy('timestamp','desc'));
    const snap = await window._fb.getDocs(q);
    docsAdmin  = snap.docs.map(d => ({id:d.id,...d.data()}));
    renderAdmin(docsAdmin);
  } catch(e) {
    console.error(e);
    toast('Error al cargar: '+e.message,'err');
  }
}

function renderAdmin(docs) {
  const unicos = [...new Set(docs.map(d=>d.email))];
  $('st-total').textContent  = docs.length;
  $('st-unicos').textContent = unicos.length;
  $('st-ultimo').textContent = docs.length ? `${docs[0].fechaTexto} · ${docs[0].horaTexto}` : 'Sin entregas aún';

  /* Personas */
  const porPersona = {};
  docs.forEach(d => {
    if (!porPersona[d.email]) porPersona[d.email]={...d,cant:0,areas:new Set()};
    porPersona[d.email].cant++;
    if(d.area) porPersona[d.email].areas.add(d.area);
  });
  $('admin-personas').innerHTML = Object.values(porPersona)
    .sort((a,b)=>b.cant-a.cant)
    .map(p=>`
      <div class="persona-row">
        <img class="persona-foto" src="${p.foto||avatar(p.nombre)}" alt="" onerror="this.src='${avatar(p.nombre)}'">
        <div class="persona-info">
          <div class="persona-nombre">${p.nombre||'—'}</div>
          <div class="persona-email">${p.email}</div>
          <div class="persona-ultima">Área(s): ${[...p.areas].join(', ')||'—'} · Último: ${p.fechaTexto} · ${p.horaTexto}</div>
        </div>
        <span class="persona-badge">${p.cant} archivo${p.cant>1?'s':''}</span>
      </div>`).join('') || '<p class="cargando-txt">Sin entregas</p>';

  /* Tabla */
  $('tabla-body').innerHTML = docs.length===0
    ? `<tr><td colspan="9" class="td-vacio">No hay registros para los filtros aplicados</td></tr>`
    : docs.map((d,i)=>`
        <tr class="${d.archivado?'tr-archivado':''}">
          <td class="td-n">${i+1}</td>
          <td><div class="td-user">
            <img class="td-foto" src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
            <div><div class="td-nombre">${d.nombre||'—'}</div><div class="td-email">${d.email}</div></div>
          </div></td>
          <td><span class="badge-area">${d.area||'—'}</span></td>
          <td class="td-arch">${renderDescarga(d)}</td>
          <td class="td-detalle" title="${d.detalle||'—'}">${d.detalle ? (d.detalle.length>40 ? d.detalle.slice(0,40)+'…' : d.detalle) : '<span style="color:#9ca3af">—</span>'}</td>
          <td class="td-peso">${d.tamanoTexto||'—'}${d.tamanoComprimido?`<div class="td-comprimido">gzip: ${d.tamanoComprimido}</div>`:''}</td>
          <td class="td-fecha">${d.fechaTexto}</td>
          <td class="td-hora">${d.horaTexto}</td>
          <td>${d.archivado
            ? `<span class="badge-archivado">Archivado</span>`
            : `<span class="badge-activo">Activo</span>`}</td>
        </tr>`).join('');

  $('filtro-resultado').textContent=`${docs.length} registro${docs.length!==1?'s':''} encontrado${docs.length!==1?'s':''}`;
}

function renderDescarga(d) {
  const svg = `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  if (d.storageURL)
    return `<a href="${d.storageURL}" target="_blank" class="link-archivo">${svg}${d.nombreArchivo}</a>`;
  return `<span style="color:var(--txt3);font-size:12px;">${d.nombreArchivo||'—'}</span>`;
}

/* ══════════════════════════════════
   FILTROS
══════════════════════════════════ */
function filtrarDocs(docs) {
  const area   = $('filtro-area').value.toLowerCase();
  const nombre = $('filtro-nombre').value.trim().toLowerCase();
  const email  = $('filtro-email').value.trim().toLowerCase();
  const fechaD = $('filtro-fecha-desde').value;
  const fechaH = $('filtro-fecha-hasta').value;
  let r = [...docs];
  if (area)   r=r.filter(d=>(d.area||'').toLowerCase().includes(area));
  if (nombre) r=r.filter(d=>(d.nombre||'').toLowerCase().includes(nombre));
  if (email)  r=r.filter(d=>(d.email||'').toLowerCase().includes(email));
  if (fechaD) r=r.filter(d=>d.timestamp>=new Date(fechaD).toISOString());
  if (fechaH){ const h=new Date(fechaH); h.setHours(23,59,59); r=r.filter(d=>d.timestamp<=h.toISOString()); }
  return r;
}

function aplicarFiltros(){ renderAdmin(filtrarDocs(docsAdmin)); }

function limpiarFiltros(){
  ['filtro-area','filtro-nombre','filtro-email','filtro-fecha-desde','filtro-fecha-hasta']
    .forEach(id=>{ const e=$(id); if(e) e.value=''; });
  renderAdmin(docsAdmin);
}

function exportarFiltrado(){ exportarExcel(filtrarDocs(docsAdmin),true); }

/* ══════════════════════════════════
   EXPORTAR EXCEL
══════════════════════════════════ */
const avatar = n =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(n||'?')}&background=1d4ed8&color=fff`;

async function exportarExcel(docs, filtrado=false){
  if (!window.XLSX){
    await new Promise((res,rej)=>{
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }
  const filas = docs.map((d,i)=>({
    '#':i+1,
    'Nombre':d.nombre||'—',
    'Correo':d.email||'—',
    'Área':d.area||'—',
    'Archivo':d.nombreArchivo||'—',
    'Descripción':d.detalle||'—',
    'Peso':d.tamanoTexto||'—',
    'Fecha':d.fechaTexto||'—',
    'Hora':d.horaTexto||'—',
    'Estado':d.archivado?'ARCHIVADO':'Activo'
  }));
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(filas);
  ws['!cols']=[{wch:4},{wch:28},{wch:34},{wch:22},{wch:38},{wch:40},{wch:12},{wch:22},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb,ws,'Entregas');
  XLSX.writeFile(wb,`informe_SISCTE${filtrado?'_filtrado':'_completo'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Informe${filtrado?' filtrado':''} descargado ✓`);
}

/* ══════════════════════════════════════════════════════
   SISTEMA DE ARCHIVADO MENSUAL
   ─ Descarga todos los archivos del mes seleccionado
   ─ Pregunta confirmación antes de liberar binarios
   ─ Conserva el historial (metadatos) para siempre
   ─ Marca los registros como archivados en Firestore
══════════════════════════════════════════════════════ */

/* ── Habilitar botón de descarga solo si los 3 checks están marcados ── */
window.verificarChecks = function() {
  const ok = $('check1')?.checked && $('check2')?.checked && $('check3')?.checked;
  const btn = $('arch-btn-descargar');
  if (btn) btn.disabled = !ok;
};

/* ── Abre el modal de archivado ── */
function abrirModalArchivado() {
  // Construir lista de meses disponibles con archivos NO archivados
  const mesesMap = {};
  docsAdmin.forEach(d => {
    if (d.archivado) return;
    if (!d.storageURL) return; // sin URL de Drive no se puede archivar
    const mes = d.timestamp.slice(0,7);
    if (!mesesMap[mes]) mesesMap[mes] = { docs:[], label: labelMes(d.timestamp) };
    mesesMap[mes].docs.push(d);
  });

  const meses = Object.entries(mesesMap).sort((a,b)=>b[0].localeCompare(a[0]));

  if (meses.length === 0) {
    toast('No hay archivos pendientes de archivar','ok');
    return;
  }

  // Poblar select de meses en el modal
  const sel = $('arch-mes-select');
  sel.innerHTML = '<option value="">— Selecciona el mes —</option>';
  meses.forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${val.label} (${val.docs.length} archivo${val.docs.length>1?'s':''})`;
    sel.appendChild(opt);
  });

  // Guardar meses en memoria para usarlos al confirmar
  window._archMeses = mesesMap;

  $('modal-archivado').style.display = 'flex';
  $('arch-paso1').style.display = 'block';
  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'none';
  $('arch-btn-siguiente').disabled = true;
}

/* ── Label legible del mes ── */
function labelMes(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return d.toLocaleDateString('es-EC', { month:'long', year:'numeric', timeZone:'America/Guayaquil' });
}

/* ── El admin seleccionó un mes: mostrar resumen ── */
function seleccionarMesArchivado() {
  const mes = $('arch-mes-select').value;
  $('arch-btn-siguiente').disabled = !mes;
  if (!mes) return;
  const info = window._archMeses[mes];
  $('arch-resumen').innerHTML = `
    <div class="arch-stat"><span>${info.docs.length}</span> archivos a descargar y archivar</div>
    <div class="arch-personas">
      ${info.docs.map(d=>`
        <div class="arch-persona-row">
          <img src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
          <div>
            <div class="arch-persona-nombre">${d.nombre||'—'} <span class="badge-area" style="font-size:10px">${d.area||''}</span></div>
            <div class="arch-persona-archivo">${d.nombreArchivo} · ${d.tamanoTexto||'—'}</div>
          </div>
        </div>`).join('')}
    </div>`;
}

/* ── Avanzar a paso 2 (advertencia) ── */
function archPaso2() {
  const mes = $('arch-mes-select').value;
  if (!mes) return;
  $('arch-paso1').style.display = 'none';
  $('arch-paso2').style.display = 'block';
  const info = window._archMeses[mes];
  $('arch-advertencia-detalle').textContent =
    `Se descargarán ${info.docs.length} archivo(s) de ${labelMes(info.docs[0].timestamp)}. ` +
    `Después podrás eliminar los binarios de la base de datos. El historial de envíos quedará guardado permanentemente.`;
}

/* ── PASO 3: Descargar todos los archivos del mes ── */
async function descargarMesCompleto() {
  const mes  = $('arch-mes-select').value;
  const info = window._archMeses[mes];

  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'block';
  $('arch-progreso-txt').textContent = 'Abriendo archivos de Drive...';

  let ok = 0;
  for (let i=0; i<info.docs.length; i++) {
    const d = info.docs[i];
    $('arch-progreso-bar').style.width = Math.round(((i+1)/info.docs.length)*100)+'%';
    $('arch-progreso-txt').textContent = `Abriendo ${i+1} de ${info.docs.length}: ${d.nombreArchivo}`;
    try {
      if (d.storageURL) window.open(d.storageURL, '_blank');
      ok++;
    } catch(e) { console.warn('Error abriendo', d.nombreArchivo, e); }
    await new Promise(r => setTimeout(r, 400));
  }

  $('arch-progreso-txt').textContent = `✓ ${ok} de ${info.docs.length} archivos abiertos desde Drive`;
  $('arch-btn-archivar').style.display = 'block';
  $('arch-btn-archivar').onclick = () => confirmarArchivar(mes, info.docs);
}

/* ── CONFIRMAR ARCHIVADO: Marcar como archivados en Firestore ── */
async function confirmarArchivar(mes, docs) {
  $('arch-btn-archivar').disabled = true;
  $('arch-btn-archivar').textContent = 'Archivando...';
  $('arch-progreso-txt').textContent = 'Marcando registros como archivados...';

  try {
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    let procesados = 0;
    for (const d of docs) {
      $('arch-progreso-bar').style.width = Math.round(((procesados+1)/docs.length)*100)+'%';
      await updateDoc(doc(db,'entregas',d.id), {
        archivado:      true,
        fechaArchivado: new Date().toISOString(),
        notaArchivado:  `Archivado el ${new Date().toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'})}`
      });
      procesados++;
      await new Promise(r => setTimeout(r, 150));
    }

    $('arch-progreso-txt').textContent = `✓ ${procesados} registros archivados. Historial conservado.`;
    $('arch-btn-archivar').textContent = '✓ Archivado completado';

    setTimeout(async () => {
      cerrarModalArchivado();
      await cargarAdmin();
      toast(`Mes ${labelMes(docs[0].timestamp)} archivado correctamente ✓`);
    }, 2000);

  } catch(e) {
    toast('Error al archivar: '+e.message,'err');
    $('arch-btn-archivar').disabled = false;
    $('arch-btn-archivar').textContent = 'Reintentar archivado';
  }
}

function cerrarModalArchivado() {
  $('modal-archivado').style.display = 'none';
}

/* ── Exponer funciones al HTML inline ── */
window.abrirModalArchivado    = abrirModalArchivado;
window.irSubir                = irSubir;
window.cerrarModalArchivado   = cerrarModalArchivado;
window.seleccionarMesArchivado = seleccionarMesArchivado;
window.archPaso2              = archPaso2;
window.descargarMesCompleto   = descargarMesCompleto;
