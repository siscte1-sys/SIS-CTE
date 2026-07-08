/* ══════════════════════════════════════════════════════════
   SISCTE v6.0 — app.js
   Integración: Novedades (nuevo) + Envíos (existente)
   Funcionalidades principales:
   • Módulo Novedades con validación de códigos
   • Auto-relleno, bloqueos, reportes automáticos
   • Panel Admin completo
   • Auditoría indefinida
   • Notificaciones por correo
   
   Este archivo contiene la lógica base y funciones comunes.
   Ver app_v6_p2.js para módulo de Novedades y Admin.
══════════════════════════════════════════════════════════ */

/* ── Firebase ────────────────────────────────────────── */
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyDPgK1CBF0sO00j6Rho_e9xkc9Xj2HdPaI",
  authDomain:        "sis-cte1.firebaseapp.com",
  projectId:         "sis-cte1",
  storageBucket:     "sis-cte1.firebasestorage.app",
  messagingSenderId: "861145504172",
  appId:             "1:861145504172:web:daa073aec7e6478709c209"
};

/* ── GAS Mailer ──────────────────────────────────────── */
const GAS_MAILER_URL = 'https://script.google.com/macros/s/AKfycbxVjHN7-NeDy2e0mhZ5RPIoqnUhzt86sW6v1HJlhmMaBtI-3PJlM2ZuSI1Wdvtf2jR8/exec';

/* ── Google Drive ────────────────────────────────────── */
const GDRIVE_CONFIG = {
  clientId: '861145504172-qf14jcon0msi3hl3l5cn5j5eard2gdvb.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive'
};
const GDRIVE_CARPETA_GENERAL      = '1EBYsTtNi7JMTOYqKSnjFWnipmaq1L_LU';
const GDRIVE_CARPETA_COMPROBANTES = '1sZnOusOY3mT-nidmdlveKaj3FxX5WG5_';

/* ── Admin y Áreas ───────────────────────────────────── */
const ADMIN_EMAILS = ["sis.cte1@gmail.com"];
const AREAS = [
  "SUB ZONA GUAYAS","ZONA 8",
  "CEBAF AREA COMPUTO NACIONAL",
  "PROV_PICHINCHA","PROV_MANABI","PROV_SANTO DOMINGO",
  "PROV_LOS RIOS","PROV_BOLIVAR","PROV_SANTA ELENA",
  "PROV_AZUAY","PROV_EL ORO",
  "UREM","OIAT","EDU_VIAL","CRV","ECU-911"
];

/* ── Códigos de Novedad (8 exactos) ──────────────────– */
const CODIGOS_VALIDOS = ["S/N", "UTA", "X", "CS", "B", "L", "V", "PE"];
const CODIGOS_DESC = {
  "S/N": "SIN NOVEDAD (normal)",
  "UTA": "UTA ÁREA — Formulario Único de Traslado (FUT)",
  "X":   "AUSENCIA INJUSTIFICADA",
  "CS":  "COMISIÓN DE SERVICIO",
  "B":   "BAJA (Fallecido, Destitucion, Renuncia)",
  "L":   "LICENCIA (Paternidad, Matrimonio, Calamidad, Maternidad)",
  "V":   "VACACIONES",
  "PE":  "PERMISO"
};

/* ── Variables Globales ──────────────────────────────– */
let db, auth, usuario = null;
let archivoSeleccionado  = null;
let informeSeleccionado  = null;
let actaSeleccionada     = null;
let docsAdmin           = [];
let _firebaseReady      = null;
let _driveTokenCache    = null;
let _driveTokenExpiry   = 0;

// Variables para Novedades
let novedadesActuales   = null;
let areaActual          = null;
let mesActual           = null;

/* ══════════════════════════════════
   FIREBASE INIT
══════════════════════════════════ */
let _resolveFirebase;
_firebaseReady = new Promise(res => { _resolveFirebase = res; });

async function initFirebase() {
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getFirestore, collection, addDoc, getDocs, orderBy, query, doc, getDoc, setDoc, updateDoc, deleteDoc, where, limit, startAfter, writeBatch } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const { getAuth, GoogleAuthProvider, signInWithPopup, signInWithRedirect, getRedirectResult, signOut, onAuthStateChanged, createUserWithEmailAndPassword, signInWithEmailAndPassword, sendPasswordResetEmail, updateProfile } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js");

    const app = initializeApp(FIREBASE_CONFIG);
    db   = getFirestore(app);
    auth = getAuth(app);

    window._fb = {
      collection, addDoc, getDocs, orderBy, query, doc, getDoc, setDoc, updateDoc, deleteDoc, where, limit, startAfter, writeBatch,
      GoogleAuthProvider, signInWithPopup, signInWithRedirect,
      getRedirectResult, signOut, onAuthStateChanged,
      createUserWithEmailAndPassword, signInWithEmailAndPassword,
      sendPasswordResetEmail, updateProfile
    };

    try {
      const result = await getRedirectResult(auth);
      if (result?.user) console.log('✓ Redirect login:', result.user.email);
    } catch(e) { console.warn('Redirect result:', e.message); }

    onAuthStateChanged(auth, u => {
      if (u) {
        usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
        actualizarNav();
        show('nb-novedades');
        show('nb-envios');
        esAdmin() ? show('nb-admin') : hide('nb-admin');
        irNovedades();
      } else {
        usuario = null;
        actualizarNav();
        ir('vista-login');
      }
    });

    _resolveFirebase();
  } catch(e) {
    console.error('❌ Error Firebase:', e);
    toast('Error iniciando sistema: ' + e.message, 'err');
    _resolveFirebase();
  }
}

/* ══════════════════════════════════
   AUTH
══════════════════════════════════ */
async function login() {
  try {
    await _firebaseReady;
    const provider = new window._fb.GoogleAuthProvider();
    provider.addScope('profile');
    provider.addScope('email');
    try {
      toast('Abriendo ventana de Google...', 'ok');
      await window._fb.signInWithPopup(auth, provider);
    } catch(popupErr) {
      if (['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(popupErr.code)) {
        toast('Redirigiendo a Google...', 'ok');
        await window._fb.signInWithRedirect(auth, provider);
      } else { throw popupErr; }
    }
  } catch(e) {
    if (!['auth/popup-closed-by-user','auth/cancelled-popup-request'].includes(e.code))
      toast('Error: ' + (e.message || e.code), 'err');
  }
}

async function logout() {
  _driveTokenCache = null; _driveTokenExpiry = 0;
  try { await window._fb.signOut(auth); } catch(e) {}
}

const esAdmin = () => usuario && ADMIN_EMAILS.map(x => x.toLowerCase()).includes(usuario.email.toLowerCase());

/* ══════════════════════════════════
   DOM HELPERS
══════════════════════════════════ */
const $ = id => document.getElementById(id);
const show = id => { const e=$(id); if(!e) return; e.style.display = ['nav-sesion','nav-guest','nav-right'].includes(id) ? 'flex' : 'block'; };
const hide = id => { const e=$(id); if(e) e.style.display='none'; };
const hideAll = () => ['vista-login','vista-novedades','vista-envios','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll();
  const el = $(v); if (!el) return;
  el.style.display = v === 'vista-login' ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-novedades') $('nb-novedades')?.classList.add('active');
  if (v==='vista-envios') $('nb-envios')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function irNovedades() { ir('vista-novedades'); cargarNovedadesActuales(); }
function irEnvios() { ir('vista-envios'); }
function irAdmin() { ir('vista-admin'); }

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
      fotoEl.src = usuario.foto; fotoEl.style.display = 'block';
      const ie = $('nav-iniciales'); if (ie) ie.style.display = 'none';
    } else {
      fotoEl.style.display = 'none';
      let ie = $('nav-iniciales');
      if (!ie) {
        ie = document.createElement('div'); ie.id = 'nav-iniciales';
        ie.style.cssText = 'width:26px;height:26px;border-radius:50%;background:var(--blue);color:#fff;font-size:10px;font-weight:700;display:flex;align-items:center;justify-content:center;flex-shrink:0;';
        fotoEl.parentNode.insertBefore(ie, fotoEl.nextSibling);
      }
      const nombre = usuario.nombre || usuario.email || '?';
      const p = nombre.trim().split(' ');
      ie.textContent = p.length >= 2 ? (p[0][0]+p[1][0]).toUpperCase() : nombre.slice(0,2).toUpperCase();
      ie.style.display = 'flex';
    }
    $('nav-nombre').textContent = usuario.nombre?.split(' ')[0] || usuario.email;
    show('nav-sesion'); hide('nav-guest');
  } else {
    hide('nav-sesion'); show('nav-guest');
  }
}

/* ══════════════════════════════════
   FUNCIONES UTILIDAD
══════════════════════════════════ */

function obtenerFechaParts() {
  const hoy = new Date();
  return {
    dia: hoy.getDate(),
    mes: String(hoy.getMonth() + 1).padStart(2, '0'),
    año: hoy.getFullYear(),
    periodo: `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`
  };
}

function obtenerNombreMes(mesNum) {
  const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
  return meses[parseInt(mesNum) - 1];
}

async function registrarEnAuditoria(accion, area, correoAfectado, dia, mes, detalles, descripcion) {
  try {
    await window._fb.addDoc(window._fb.collection(db, 'auditoria'), {
      admin: usuario.email,
      accion: accion,
      area: area || null,
      correoAfectado: correoAfectado || null,
      dia: dia || null,
      mes: mes || null,
      detalles: detalles || {},
      timestamp: new Date(),
      descripcion: descripcion || ''
    });
  } catch(e) {
    console.warn('No se pudo registrar en auditoría:', e);
  }
}

/* ══════════════════════════════════
   VALIDACIÓN DE CÓDIGOS
══════════════════════════════════ */

function normalizarCodigo(entrada) {
  if (!entrada) return null;
  return entrada.toUpperCase().trim();
}

function validarCodigo(codigo) {
  if (!codigo) return false;
  const norm = normalizarCodigo(codigo);
  return CODIGOS_VALIDOS.includes(norm);
}

function obtenerCodigoValidoSimilar(entrada) {
  const norm = normalizarCodigo(entrada);
  // Auto-corrección simple: si es similar a un código válido, corregir
  for (const codigo of CODIGOS_VALIDOS) {
    if (codigo.includes(norm) || norm.includes(codigo.slice(0, 1))) {
      return codigo;
    }
  }
  return null;
}

/* ══════════════════════════════════
   ENVÍOS (Código original, mantenido)
══════════════════════════════════ */

// Las funciones de envíos se cargan DESPUÉS en el script
// Aquí solo es la estructura base

async function cargarAreasEnSelect() {
  const select = $('area-select');
  if (!select) return;
  select.innerHTML = '<option value="">Seleccioná un área</option>';
  AREAS.forEach(area => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = area;
    select.appendChild(opt);
  });
}

/* ══════════════════════════════════
   INICIALIZACIÓN
══════════════════════════════════ */

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  
  // Event listeners: Navbar
  const btnGoogle = $('btn-google');
  if (btnGoogle) btnGoogle.addEventListener('click', login);
  
  const btnLogout = document.querySelector('.btn-logout');
  if (btnLogout) btnLogout.addEventListener('click', logout);

  // Event listeners: Pestañas
  const nbNovedades = $('nb-novedades');
  if (nbNovedades) nbNovedades.addEventListener('click', irNovedades);
  
  const nbEnvios = $('nb-envios');
  if (nbEnvios) nbEnvios.addEventListener('click', irEnvios);
  
  const nbAdmin = $('nb-admin');
  if (nbAdmin) nbAdmin.addEventListener('click', irAdmin);

  // Event listeners: Admin tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const content = $(`admin-tab-${tabName}`);
      if (content) content.style.display = 'block';
    });
  });

  // Cargar áreas
  cargarAreasEnSelect();

  // Inicializar dropzone (envíos)
  const dropzone = $('dropzone');
  if (dropzone) {
    dropzone.addEventListener('click', () => $('file-input').click());
    dropzone.addEventListener('dragover', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--blue)';
    });
    dropzone.addEventListener('dragleave', () => {
      dropzone.style.borderColor = 'var(--border)';
    });
    dropzone.addEventListener('drop', (e) => {
      e.preventDefault();
      dropzone.style.borderColor = 'var(--border)';
      const files = e.dataTransfer.files;
      if (files.length > 0) {
        $('file-input').files = files;
        actualizarPreviewArchivo();
      }
    });
  }

  const fileInput = $('file-input');
  if (fileInput) fileInput.addEventListener('change', actualizarPreviewArchivo);
});

// Inicializar cuando Firebase esté listo
_firebaseReady.then(() => {
  cargarAreasEnSelect();
});

/* ══════════════════════════════════
   Importar módulo de Novedades
   (Se carga en segundo archivo)
══════════════════════════════════ */

// Ver app_v6_p2.js para funciones de Novedades y Admin
