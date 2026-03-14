/* ══════════════════════════════════════════════════════════
   PORTAL SISCTE — app.js  v5.0
   ─ Almacenamiento: todos los archivos → Google Drive
     (carpeta por área, se crea automáticamente)
   ─ Firestore: solo guarda metadatos (nombre, área, fecha…)
   ─ EmailJS: correo al usuario + alerta al admin con link Drive
   ─ PDF comprobante descargado automáticamente al enviar
   ─ Panel admin con filtros y exportación Excel filtrada
   ─ Archivado mensual con checkboxes individuales + rango de fechas
   ─ Limpieza total de BD con descarga Excel previa y doble confirmación
══════════════════════════════════════════════════════════ */

const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDPgK1CBF0sO00j6Rho_e9xkc9Xj2HdPaI",
  authDomain:        "sis-cte1.firebaseapp.com",
  projectId:         "sis-cte1",
  storageBucket:     "sis-cte1.firebasestorage.app",
  messagingSenderId: "861145504172",
  appId:             "1:861145504172:web:daa073aec7e6478709c209"
};

/* ── EMAILJS — Usuario ───────────────────────────────────
   Servicio original: correo de confirmación al usuario
──────────────────────────────────────────────────────── */
const EMAILJS_CONFIG = {
  publicKey:  "gaScEoguCEcx7aFYT",
  serviceId:  "service_ybvnh3i",
  templateId: "template_8d6u82j"
};

/* ── EMAILJS — Admin ─────────────────────────────────────
   Servicio Gmail sis.cte1: alerta al administrador
   Variables: to_email, usuario_nombre, usuario_email,
              area, archivo, tamano, fecha, hora,
              link_archivo, link_carpeta
──────────────────────────────────────────────────────── */
const EMAILJS_ADMIN_SERVICE  = "service_olg4mtm";   // ← Gmail sis.cte1
const EMAILJS_ADMIN_TEMPLATE = "template_kxdf3rr";  // ← template admin

/* Google Drive API — todos los archivos se suben aquí */
const GDRIVE_CONFIG = {
  clientId: '861145504172-qf14jcon0msi3hl3l5cn5j5eard2gdvb.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive'
};

/* ID de la carpeta raíz GENERAL en Google Drive
   Las subcarpetas por área se crean automáticamente aquí dentro */
const GDRIVE_ROOT_FOLDER_ID  = '1EBYsTtNi7JMTOYqKSnjFWnipmaq1L_LU';
const GDRIVE_CARPETA_GENERAL = '1EBYsTtNi7JMTOYqKSnjFWnipmaq1L_LU'; // ← misma carpeta GENERAL

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
let _firebaseReady = null;

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

  _resolveFirebase();
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
async function login() {
  try {
    await _firebaseReady;
    const provider = new window._fb.GoogleAuthProvider();
    try {
      await window._fb.signInWithPopup(auth, provider);
    } catch(popupErr) {
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
  archivoSeleccionado = null;
  const fi = $('file-input');
  if (fi) fi.value = '';
  $('dropzone').style.display    = 'flex';
  $('file-preview').style.display = 'none';
  $('progress-wrap').style.display = 'none';
  $('area-select').value = '';
  const det = $('detalle-envio'); if (det) det.value = '';
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

function setProgreso(pct, label) {
  $('progress-bar').style.width = pct+'%';
  $('progress-txt').textContent = pct+'%';
  const lbl = $('progress-label-txt');
  if (lbl) lbl.textContent = label||'';
}

/* ══════════════════════════════════════════════════════
   GOOGLE DRIVE UPLOAD — vía Google Apps Script
   La cuenta de servicio sube el archivo en el servidor.
   El usuario NO ve ninguna pantalla de autorización.
══════════════════════════════════════════════════════ */

const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbym9xH3jVqfzKNeOxGS7RARdPWAxjfosnR3mslAzn9nQ8xvtck60eCxieVtS7PcP_A4/exec';

async function subirAGoogleDrive(archivo, onProgress) {
  console.log('\n📤 SUBIENDO ARCHIVO VÍA APPS SCRIPT\n');

  const area = document.getElementById('area-select')?.value;
  if (!area) throw new Error('No se seleccionó área');

  onProgress(10);

  /* Leer archivo como base64 */
  const fileB64 = await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result.split(',')[1]);
    reader.onerror = () => reject(new Error('Error leyendo el archivo'));
    reader.readAsDataURL(archivo);
  });

  onProgress(35);

  const fecha    = new Date().toISOString().slice(0, 10);
  const mimeType = archivo.type ||
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

  const payload = JSON.stringify({
    fileData: fileB64,
    fileName: archivo.name,
    mimeType,
    area,
    fecha
  });

  onProgress(45);
  console.log('📡 Enviando al Apps Script...');

  /* Usar Content-Type: text/plain evita el preflight CORS que bloquea Apps Script.
     Apps Script acepta este content-type y parsea el JSON internamente. */
  const res = await fetch(APPS_SCRIPT_URL, {
    method:   'POST',
    redirect: 'follow',
    headers:  { 'Content-Type': 'text/plain;charset=utf-8' },
    body:     payload
  });

  onProgress(85);

  if (!res.ok) {
    const txt = await res.text().catch(() => res.status);
    throw new Error('Error del servidor: ' + txt);
  }

  const texto = await res.text();
  console.log('📥 Respuesta:', texto.slice(0, 300));

  let respuesta;
  try {
    respuesta = JSON.parse(texto);
  } catch(e) {
    throw new Error('Respuesta inválida del servidor: ' + texto.slice(0, 100));
  }

  if (!respuesta.ok) {
    throw new Error(respuesta.error || 'El servidor no pudo procesar el archivo');
  }

  onProgress(95);
  console.log('✅ Archivo subido:', respuesta.fileId);

  return {
    fileUrl:   respuesta.fileUrl,
    folderUrl: respuesta.folderUrl,
    folderId:  respuesta.folderId,
    fileId:    respuesta.fileId
  };
}

/* ══════════════════════════════════
   ENVIAR ARCHIVO
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

    setProgreso(20, 'Conectando con Google Drive...');
    const driveResult = await subirAGoogleDrive(archivoSeleccionado, (p) => {
      setProgreso(20 + Math.round(p * 0.6), `Subiendo a Drive... ${p}%`);
    });

    const storageURL  = driveResult.fileUrl;
    const folderURL   = driveResult.folderUrl;

    setProgreso(80,'Registrando en Firestore...');

    const { where, deleteDoc, doc: docRef } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const qDup = window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid',          '==', usuario.uid),
      where('nombreArchivo','==', archivoSeleccionado.name),
      where('area',         '==', areaVal)
    );
    const snapDup = await window._fb.getDocs(qDup);
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
      folderURL,
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

    // Correo al usuario (confirmación)
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

    // Correo al admin con alerta y link a la carpeta
    enviarCorreoAdmin({
      nombre:    usuario.nombre,
      email:     usuario.email,
      area:      areaVal,
      archivo:   archivoSeleccionado.name,
      tamano:    formatSize(archivoSeleccionado.size),
      fecha:     fechaTexto,
      hora:      horaTexto,
      registro:  numRegistro,
      storageURL,
      folderURL
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
   COMPROBANTE PDF
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

    doc.setFillColor(37, 99, 235);
    doc.rect(0, 0, W, 42, 'F');
    doc.setFillColor(255, 255, 255);
    doc.roundedRect(14, 9, 24, 24, 5, 5, 'F');
    doc.setTextColor(37, 99, 235);
    doc.setFontSize(15);
    doc.setFont('helvetica', 'bold');
    doc.text('S', 22, 25);
    doc.setFillColor(29, 78, 216);
    doc.rect(14, 30, 24, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16);
    doc.setFont('helvetica', 'bold');
    doc.text('SISCTE - Comprobante de Envio', 44, 20);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'normal');
    doc.text('Sistema de Gestion de Documentos Excel', 44, 28);
    doc.text('Este documento certifica el registro exitoso de tu archivo.', 44, 35);
    doc.setFillColor(22, 163, 74);
    doc.roundedRect(14, 50, 52, 11, 3, 3, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9);
    doc.setFont('helvetica', 'bold');
    doc.text('REGISTRADO', 19, 57.5);
    doc.setTextColor(107, 114, 128);
    doc.setFontSize(8);
    doc.setFont('helvetica', 'normal');
    doc.text('No. de Registro: ' + d.registro, 70, 57);

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

    doc.setDrawColor(229, 231, 235);
    doc.setLineWidth(0.5);
    doc.line(14, y + 2, W - 14, y + 2);
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
   EMAILJS — Correo al usuario
══════════════════════════════════ */
async function cargarEmailJS() {
  if (!window.emailjs) {
    await new Promise((res,rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdn.jsdelivr.net/npm/@emailjs/browser@4/dist/email.min.js';
      s.onload=res; s.onerror=rej;
      document.head.appendChild(s);
    });
    emailjs.init(EMAILJS_CONFIG.publicKey);
  }
}

async function enviarCorreoNotificacion(datos) {
  try {
    await cargarEmailJS();
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
    console.warn('EmailJS usuario:', e.message||e);
  }
}

/* ══════════════════════════════════
   EMAILJS — Alerta al admin
   ─ Usa service_olg4mtm (Gmail sis.cte1)
   ─ Usa template_kxdf3rr (template admin)
══════════════════════════════════ */
async function enviarCorreoAdmin(datos) {
  try {
    await cargarEmailJS();
    await emailjs.send(EMAILJS_ADMIN_SERVICE, EMAILJS_ADMIN_TEMPLATE, {
      to_email:       ADMIN_EMAILS[0],
      to_name:        'Administrador SISCTE',
      usuario_nombre: datos.nombre,
      usuario_email:  datos.email,
      area:           datos.area,
      archivo:        datos.archivo,
      tamano:         datos.tamano,
      fecha:          datos.fecha,
      hora:           datos.hora,
      registro:       datos.registro,
      link_archivo:   datos.storageURL,
      link_carpeta:   datos.folderURL
    });
    console.log('✓ Alerta enviada al admin');
  } catch(e) {
    // No mostrar error al usuario si falla el correo al admin
    console.warn('EmailJS admin:', e.message||e);
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
          <td class="td-peso">${d.tamanoTexto||'—'}</td>
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
    'Estado':d.archivado?'ARCHIVADO':'Activo',
    'Link Drive':d.storageURL||'—'
  }));
  const wb=XLSX.utils.book_new();
  const ws=XLSX.utils.json_to_sheet(filas);
  ws['!cols']=[{wch:4},{wch:28},{wch:34},{wch:22},{wch:38},{wch:40},{wch:12},{wch:22},{wch:14},{wch:12},{wch:50}];
  XLSX.utils.book_append_sheet(wb,ws,'Entregas');
  XLSX.writeFile(wb,`informe_SISCTE${filtrado?'_filtrado':'_completo'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Informe${filtrado?' filtrado':''} descargado ✓`);
}

/* ══════════════════════════════════════════════════════
   SISTEMA DE ARCHIVADO MENSUAL v2
══════════════════════════════════════════════════════ */

window.verificarChecks = function() {
  const ok = $('check1')?.checked && $('check2')?.checked && $('check3')?.checked;
  const btn = $('arch-btn-descargar');
  if (btn) btn.disabled = !ok;
};

function labelMes(isoTimestamp) {
  const d = new Date(isoTimestamp);
  return d.toLocaleDateString('es-EC', { month:'long', year:'numeric', timeZone:'America/Guayaquil' });
}

function abrirModalArchivado() {
  const mesesMap = {};
  docsAdmin.forEach(d => {
    if (d.archivado) return;
    if (!d.storageURL) return;
    const mes = d.timestamp.slice(0,7);
    if (!mesesMap[mes]) mesesMap[mes] = { docs:[], label: labelMes(d.timestamp) };
    mesesMap[mes].docs.push(d);
  });

  const meses = Object.entries(mesesMap).sort((a,b)=>b[0].localeCompare(a[0]));
  if (meses.length === 0) { toast('No hay archivos pendientes de archivar','ok'); return; }

  const sel = $('arch-mes-select');
  sel.innerHTML = '<option value="">— Selecciona el mes —</option>';
  meses.forEach(([key, val]) => {
    const opt = document.createElement('option');
    opt.value = key;
    opt.textContent = `${val.label} (${val.docs.length} archivo${val.docs.length>1?'s':''})`;
    sel.appendChild(opt);
  });

  window._archMeses = mesesMap;
  $('modal-archivado').style.display = 'flex';
  $('arch-paso1').style.display = 'block';
  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'none';
  $('arch-btn-siguiente').disabled = true;
}

function seleccionarMesArchivado() {
  const mes = $('arch-mes-select').value;
  $('arch-btn-siguiente').disabled = !mes;
  if (!mes) { $('arch-resumen').innerHTML = ''; return; }
  const info = window._archMeses[mes];

  const hoy = new Date().toISOString().slice(0,10);
  const primerDia = mes + '-01';

  $('arch-resumen').innerHTML = `
    <div style="margin:12px 0 8px;padding:10px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0;">
      <div style="font-size:12px;font-weight:600;color:#374151;margin-bottom:8px;">Filtrar por rango de fechas (opcional)</div>
      <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:11px;color:#6b7280;">Desde</label>
          <input type="date" id="arch-fecha-desde" value="${primerDia}" max="${hoy}"
            style="border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;"
            onchange="filtrarArchivosMes()">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:11px;color:#6b7280;">Hasta</label>
          <input type="date" id="arch-fecha-hasta" value="${hoy}" max="${hoy}"
            style="border:1px solid #d1d5db;border-radius:6px;padding:4px 8px;font-size:12px;"
            onchange="filtrarArchivosMes()">
        </div>
        <button onclick="seleccionarTodosArch(true)"
          style="margin-top:14px;padding:4px 10px;background:#2563eb;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
          ✓ Todos
        </button>
        <button onclick="seleccionarTodosArch(false)"
          style="margin-top:14px;padding:4px 10px;background:#6b7280;color:#fff;border:none;border-radius:6px;font-size:11px;cursor:pointer;">
          ✗ Ninguno
        </button>
      </div>
    </div>
    <div id="arch-lista-checks" style="max-height:260px;overflow-y:auto;"></div>
    <div id="arch-contador-sel" style="font-size:12px;color:#2563eb;font-weight:600;margin-top:8px;text-align:right;"></div>`;

  window._archDocsActuales = info.docs;
  filtrarArchivosMes();
}

window.filtrarArchivosMes = function() {
  const desde = $('arch-fecha-desde')?.value || '';
  const hasta = $('arch-fecha-hasta')?.value || '';
  const docs  = window._archDocsActuales || [];

  let filtrados = [...docs];
  if (desde) filtrados = filtrados.filter(d => d.timestamp.slice(0,10) >= desde);
  if (hasta) filtrados = filtrados.filter(d => d.timestamp.slice(0,10) <= hasta);

  window._archDocsFiltrados = filtrados;

  const lista = $('arch-lista-checks');
  if (!lista) return;

  if (filtrados.length === 0) {
    lista.innerHTML = `<p style="text-align:center;color:#9ca3af;font-size:12px;padding:16px;">Sin archivos en ese rango</p>`;
    actualizarContadorArch();
    $('arch-btn-siguiente').disabled = true;
    return;
  }

  lista.innerHTML = filtrados.map((d,i) => `
    <label style="display:flex;align-items:flex-start;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6;cursor:pointer;">
      <input type="checkbox" class="arch-check" data-idx="${i}" checked
        style="margin-top:3px;width:15px;height:15px;accent-color:#2563eb;"
        onchange="actualizarContadorArch()">
      <div style="flex:1;min-width:0;">
        <div style="font-size:12px;font-weight:600;color:#111827;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${d.nombreArchivo}</div>
        <div style="font-size:11px;color:#6b7280;">
          <span style="background:#eff6ff;color:#1d4ed8;padding:1px 6px;border-radius:4px;font-weight:600;font-size:10px;">${d.area||'—'}</span>
          &nbsp;${d.nombre||'—'} · ${d.fechaTexto} · ${d.tamanoTexto||'—'}
        </div>
      </div>
    </label>`).join('');

  actualizarContadorArch();
  $('arch-btn-siguiente').disabled = false;
};

window.actualizarContadorArch = function() {
  const checks = document.querySelectorAll('.arch-check');
  const sel = [...checks].filter(c => c.checked).length;
  const contador = $('arch-contador-sel');
  if (contador) contador.textContent = `${sel} de ${checks.length} seleccionado${sel!==1?'s':''}`;
  $('arch-btn-siguiente').disabled = sel === 0;
};

window.seleccionarTodosArch = function(val) {
  document.querySelectorAll('.arch-check').forEach(c => c.checked = val);
  actualizarContadorArch();
};

function archPaso2() {
  const checks  = document.querySelectorAll('.arch-check');
  const selDocs = [];
  checks.forEach((c, i) => {
    if (c.checked && window._archDocsFiltrados?.[i]) selDocs.push(window._archDocsFiltrados[i]);
  });
  if (selDocs.length === 0) { toast('Selecciona al menos un archivo','err'); return; }
  window._archDocsSeleccionados = selDocs;

  $('arch-paso1').style.display = 'none';
  $('arch-paso2').style.display = 'block';
  $('arch-advertencia-detalle').textContent =
    `Se descargarán ${selDocs.length} archivo(s) seleccionado(s). ` +
    `Después podrás marcarlos como archivados. El historial de envíos quedará guardado permanentemente.`;
}

async function descargarMesCompleto() {
  const docs = window._archDocsSeleccionados || [];
  $('arch-paso2').style.display = 'none';
  $('arch-paso3').style.display = 'block';
  $('arch-progreso-txt').textContent = 'Abriendo archivos de Drive...';

  let ok = 0;
  for (let i=0; i<docs.length; i++) {
    const d = docs[i];
    $('arch-progreso-bar').style.width = Math.round(((i+1)/docs.length)*100)+'%';
    $('arch-progreso-txt').textContent = `Abriendo ${i+1} de ${docs.length}: ${d.nombreArchivo}`;
    try {
      if (d.storageURL) window.open(d.storageURL, '_blank');
      ok++;
    } catch(e) { console.warn('Error abriendo', d.nombreArchivo, e); }
    await new Promise(r => setTimeout(r, 400));
  }

  $('arch-progreso-txt').textContent = `✓ ${ok} de ${docs.length} archivos abiertos desde Drive`;
  $('arch-btn-archivar').style.display = 'block';
  $('arch-btn-archivar').onclick = () => confirmarArchivar(docs);
}

async function confirmarArchivar(docs) {
  $('arch-btn-archivar').disabled = true;
  $('arch-btn-archivar').textContent = 'Archivando...';

  try {
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    let procesados = 0;
    for (const d of docs) {
      $('arch-progreso-bar').style.width = Math.round(((procesados+1)/docs.length)*100)+'%';
      $('arch-progreso-txt').textContent = `Archivando ${procesados+1} de ${docs.length}...`;
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
      toast(`${procesados} archivo(s) archivados correctamente ✓`);
    }, 2000);
  } catch(e) {
    toast('Error al archivar: '+e.message,'err');
    $('arch-btn-archivar').disabled = false;
    $('arch-btn-archivar').textContent = 'Reintentar';
  }
}

function cerrarModalArchivado() {
  $('modal-archivado').style.display = 'none';
}

/* ══════════════════════════════════════════════════════
   LIMPIAR BASE DE DATOS
══════════════════════════════════════════════════════ */

window.verificarCheckLimpieza = function() {
  const ok = $('check-confirmar')?.checked;
  $('btn-iniciar-limpieza').disabled = !ok;
};

function abrirModalLimpiarDuplicados() {
  $('limpieza-contenido').style.display = 'block';
  $('limpieza-progreso').style.display  = 'none';
  $('check-confirmar').checked = false;
  $('btn-iniciar-limpieza').disabled = true;

  const desc = $('limpieza-contenido').querySelector('.modal-desc');
  if (desc && !$('limpieza-rango')) {
    const hoy = new Date().toISOString().slice(0,10);
    const rango = document.createElement('div');
    rango.id = 'limpieza-rango';
    rango.style.cssText = 'margin:14px 0;padding:12px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;';
    rango.innerHTML = `
      <div style="font-size:12px;font-weight:700;color:#991b1b;margin-bottom:10px;">⚠️ Esta acción es IRREVERSIBLE — elige bien el rango</div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:11px;color:#6b7280;font-weight:600;">Desde</label>
          <input type="date" id="limp-fecha-desde" max="${hoy}"
            style="border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;">
        </div>
        <div style="display:flex;flex-direction:column;gap:3px;">
          <label style="font-size:11px;color:#6b7280;font-weight:600;">Hasta</label>
          <input type="date" id="limp-fecha-hasta" value="${hoy}" max="${hoy}"
            style="border:1px solid #d1d5db;border-radius:6px;padding:5px 8px;font-size:12px;">
        </div>
      </div>
      <div id="limp-conteo" style="font-size:12px;color:#dc2626;font-weight:600;margin-top:8px;"></div>
      <button onclick="contarRegistrosLimpieza()"
        style="margin-top:8px;padding:5px 12px;background:#dc2626;color:#fff;border:none;border-radius:6px;font-size:12px;cursor:pointer;font-weight:600;">
        Ver cuántos registros se borrarán
      </button>`;
    desc.insertAdjacentElement('afterend', rango);
  }

  $('modal-limpiar-duplicados').style.display = 'flex';
}

window.contarRegistrosLimpieza = function() {
  const desde = $('limp-fecha-desde')?.value || '';
  const hasta = $('limp-fecha-hasta')?.value || '';
  let docs = [...docsAdmin];
  if (desde) docs = docs.filter(d => d.timestamp.slice(0,10) >= desde);
  if (hasta) docs = docs.filter(d => d.timestamp.slice(0,10) <= hasta);
  const conteo = $('limp-conteo');
  if (conteo) {
    if (docs.length === 0) {
      conteo.textContent = 'Sin registros en ese rango.';
      conteo.style.color = '#6b7280';
    } else {
      conteo.textContent = `⚠️ Se eliminarán ${docs.length} registro(s) permanentemente.`;
      conteo.style.color = '#dc2626';
    }
  }
  window._limpiezaDocs = docs;
};

async function iniciarLimpiezaDuplicados() {
  const docs = window._limpiezaDocs;
  if (!docs || docs.length === 0) {
    toast('Primero define el rango y verifica cuántos registros se borrarán', 'err');
    return;
  }

  const confirmar = window.confirm(
    `⚠️ ÚLTIMA ADVERTENCIA\n\n` +
    `Estás por eliminar ${docs.length} registro(s) de forma PERMANENTE.\n\n` +
    `Los archivos en Google Drive NO se eliminarán, solo los registros de Firestore ` +
    `y el historial visible en "Mis Envíos".\n\n` +
    `¿Deseas continuar?`
  );
  if (!confirmar) return;

  toast('Descargando Excel de respaldo antes de borrar...', 'ok');
  await exportarExcel(docs, true);
  await new Promise(r => setTimeout(r, 1500));

  $('limpieza-contenido').style.display = 'none';
  $('limpieza-progreso').style.display  = 'block';
  $('limpieza-resultados').innerHTML    = '';

  try {
    const { doc, deleteDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    let procesados = 0;
    const log = $('limpieza-resultados');

    for (const d of docs) {
      const pct = Math.round(((procesados+1)/docs.length)*100);
      $('limpieza-progreso-bar').style.width = pct+'%';
      $('limpieza-progreso-txt').textContent = `Eliminando ${procesados+1} de ${docs.length}...`;
      try {
        await deleteDoc(doc(db, 'entregas', d.id));
        log.innerHTML += `<div style="color:#16a34a;">✓ Eliminado: ${d.nombreArchivo} (${d.area||'—'} · ${d.fechaTexto})</div>`;
      } catch(e) {
        log.innerHTML += `<div style="color:#dc2626;">✗ Error: ${d.nombreArchivo} — ${e.message}</div>`;
      }
      log.scrollTop = log.scrollHeight;
      procesados++;
      await new Promise(r => setTimeout(r, 100));
    }

    $('limpieza-progreso-txt').textContent = `✓ ${procesados} registros eliminados permanentemente.`;
    log.innerHTML += `<div style="color:#2563eb;font-weight:700;margin-top:8px;">═══ Limpieza completada: ${procesados} registros eliminados ═══</div>`;

    setTimeout(async () => {
      cerrarModalLimpiarDuplicados();
      await cargarAdmin();
      toast(`Base de datos limpiada: ${procesados} registros eliminados ✓`);
    }, 3000);

  } catch(e) {
    toast('Error durante la limpieza: '+e.message,'err');
  }
}

function cerrarModalLimpiarDuplicados() {
  $('modal-limpiar-duplicados').style.display = 'none';
}

/* ── Exponer funciones al HTML ── */
window.abrirModalArchivado      = abrirModalArchivado;
window.irSubir                  = irSubir;
window.cerrarModalArchivado     = cerrarModalArchivado;
window.seleccionarMesArchivado  = seleccionarMesArchivado;
window.archPaso2                = archPaso2;
window.descargarMesCompleto     = descargarMesCompleto;
window.abrirModalLimpiarDuplicados   = abrirModalLimpiarDuplicados;
window.cerrarModalLimpiarDuplicados  = cerrarModalLimpiarDuplicados;
window.iniciarLimpiezaDuplicados     = iniciarLimpiezaDuplicados;

/* ── Funciones auth y envío expuestas al HTML ── */
window.login               = login;
window.logout              = logout;
window.loginEmail          = loginEmail;
window.registrarEmail      = registrarEmail;
window.olvidoContrasena    = olvidoContrasena;
window.enviarArchivo       = enviarArchivo;
