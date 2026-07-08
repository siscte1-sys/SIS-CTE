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
/* ══════════════════════════════════════════════════════════
   SISCTE v6.0 — app_v6_p2.js
   Parte 2: Módulo Novedades + Panel Admin + Envíos
   
   Importar DESPUÉS de app_v6_p1.js
══════════════════════════════════════════════════════════ */

/* ═════════════════════════════════════════
   MÓDULO NOVEDADES — Cargar datos actuales
═════════════════════════════════════════ */

async function cargarNovedadesActuales() {
  try {
    const dateParts = obtenerFechaParts();
    const periodo = dateParts.periodo;
    const diaHoy = dateParts.dia;
    
    // Obtener area del usuario desde accesos
    const accesoRef = window._fb.collection(db, 'accesos');
    const q = window._fb.query(accesoRef, window._fb.where('correo', '==', usuario.email));
    const querySnapshot = await window._fb.getDocs(q);
    
    if (querySnapshot.empty) {
      toast('❌ Tu correo no está configurado en el sistema. Contacta a soporte.', 'err');
      hide('tabla-novedades-container');
      show('tabla-cargando');
      $('tabla-cargando').textContent = '❌ Correo no configurado';
      return;
    }
    
    areaActual = querySnapshot.docs[0].data().area;
    mesActual = periodo;
    
    // Actualizar hero
    $('hero-area').textContent = areaActual;
    $('hero-mes').textContent = obtenerNombreMes(dateParts.mes);
    $('info-dia-actual').textContent = `Hoy es día ${diaHoy}`;

    // Cargar novedades del mes actual
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, periodo, 'datos');
    const novedadesDoc = await window._fb.getDoc(novedadesRef);
    
    if (!novedadesDoc.exists()) {
      // Crear estructura inicial
      await window._fb.setDoc(novedadesRef, {
        agentes: [],
        estado: 'activo',
        diasBloqueados: [],
        diasNoCompletados: Array.from({length: 31}, (_, i) => i + 1),
        fechaCreacion: new Date(),
        ultimaModificacion: new Date()
      });
      novedadesActuales = { agentes: [] };
    } else {
      novedadesActuales = novedadesDoc.data();
    }

    // Renderizar tabla
    renderizarTablaNovedades(diaHoy);
    
    // Verificar días pendientes
    verificarDiasPendientes();
    
    hide('tabla-cargando');
    show('tabla-novedades-container');
    
  } catch(e) {
    console.error('Error cargando novedades:', e);
    toast('Error cargando datos: ' + e.message, 'err');
    hide('tabla-novedades-container');
    show('tabla-cargando');
    $('tabla-cargando').textContent = '❌ Error cargando datos';
  }
}

function renderizarTablaNovedades(diaHoy) {
  const tabla = $('tabla-novedades');
  const thead = tabla.querySelector('thead tr');
  const tbody = $('tabla-novedades-body');
  
  // Limpiar cabecera (mantener primeras 5 columnas)
  const colsFijas = 5;
  while (thead.children.length > colsFijas) {
    thead.removeChild(thead.children[colsFijas]);
  }
  
  // Agregar columnas de días
  for (let dia = 1; dia <= 31; dia++) {
    const th = document.createElement('th');
    th.style.width = '45px';
    th.textContent = dia;
    if (dia === diaHoy) {
      th.style.backgroundColor = 'var(--green)';
      th.style.color = '#fff';
      th.style.fontWeight = '700';
    }
    thead.appendChild(th);
  }
  
  // Agregar columna observación
  const thObs = document.createElement('th');
  thObs.style.minWidth = '120px';
  thObs.textContent = 'Observación';
  thead.appendChild(thObs);
  
  // Limpiar cuerpo
  tbody.innerHTML = '';
  
  // Renderizar filas de agentes
  if (novedadesActuales.agentes && novedadesActuales.agentes.length > 0) {
    novedadesActuales.agentes.forEach((agente, idx) => {
      const tr = document.createElement('tr');
      
      // Columnas fijas
      const tdNum = document.createElement('td');
      tdNum.textContent = agente.numero || (idx + 1);
      tdNum.style.textAlign = 'center';
      tdNum.style.fontSize = '11px';
      tdNum.style.color = 'var(--txt3)';
      tr.appendChild(tdNum);
      
      const tdCod = document.createElement('td');
      tdCod.textContent = agente.codigo || '';
      tdCod.style.fontSize = '11px';
      tr.appendChild(tdCod);
      
      const tdGrado = document.createElement('td');
      tdGrado.textContent = agente.grado || '';
      tdGrado.style.fontSize = '11px';
      tr.appendChild(tdGrado);
      
      const tdNombre = document.createElement('td');
      tdNombre.textContent = agente.apellidosNombres || '';
      tdNombre.style.fontSize = '11px';
      tdNombre.style.whiteSpace = 'nowrap';
      tdNombre.style.overflow = 'hidden';
      tdNombre.style.textOverflow = 'ellipsis';
      tr.appendChild(tdNombre);
      
      const tdCed = document.createElement('td');
      tdCed.textContent = agente.cedula || '';
      tdCed.style.fontSize = '11px';
      tdCed.style.textAlign = 'center';
      tr.appendChild(tdCed);
      
      // Celdas de días
      for (let dia = 1; dia <= 31; dia++) {
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.style.padding = '6px 3px';
        td.style.cursor = 'pointer';
        
        const valor = agente.novedadesPorDia && agente.novedadesPorDia[String(dia)] ? agente.novedadesPorDia[String(dia)] : '';
        td.textContent = valor || '—';
        
        // Bloquear días pasados
        const bloqueado = dia < new Date().getDate() && dia !== new Date().getDate();
        if (bloqueado) {
          td.style.opacity = '0.5';
          td.style.cursor = 'not-allowed';
          td.style.backgroundColor = 'var(--bg)';
        }
        
        // Resaltar hoy
        if (dia === new Date().getDate()) {
          td.style.backgroundColor = 'var(--green-l)';
          td.style.borderColor = 'var(--green-m)';
          td.style.fontWeight = '600';
        }
        
        // Evento click (solo si hoy o admin)
        if (!bloqueado || esAdmin()) {
          td.addEventListener('click', () => {
            abrirModalEditarNovedad(agente, dia, idx);
          });
          td.addEventListener('mouseover', () => {
            if (!bloqueado || esAdmin()) td.style.backgroundColor = 'var(--blue-l)';
          });
          td.addEventListener('mouseout', () => {
            if (dia === new Date().getDate()) {
              td.style.backgroundColor = 'var(--green-l)';
            } else {
              td.style.backgroundColor = '';
            }
          });
        }
        
        tr.appendChild(td);
      }
      
      // Columna observación
      const tdObs = document.createElement('td');
      tdObs.textContent = agente.observaciones || '';
      tdObs.style.fontSize = '11px';
      tdObs.style.maxWidth = '120px';
      tdObs.style.overflow = 'hidden';
      tdObs.style.textOverflow = 'ellipsis';
      tr.appendChild(tdObs);
      
      tbody.appendChild(tr);
    });
  } else {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 40;
    td.textContent = '⚠️ No hay agentes configurados para tu área';
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--txt3)';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }
}

function verificarDiasPendientes() {
  const diaHoy = new Date().getDate();
  const diasSinCompletar = [];
  
  if (novedadesActuales.diasNoCompletados) {
    for (let dia = 1; dia < diaHoy; dia++) {
      if (novedadesActuales.diasNoCompletados.includes(dia)) {
        diasSinCompletar.push(dia);
      }
    }
  }
  
  if (diasSinCompletar.length > 0) {
    show('info-dias-pendientes');
    $('info-pendientes-txt').textContent = `⚠️ Días sin completar: ${diasSinCompletar.join(', ')}`;
  } else {
    hide('info-dias-pendientes');
  }
}

/* ═════════════════════════════════════════
   MODAL: Editar Novedad
═════════════════════════════════════════ */

let modalAgenteEdicion = null;
let modalDiaEdicion = null;
let modalIdxEdicion = null;

function abrirModalEditarNovedad(agente, dia, idx) {
  modalAgenteEdicion = agente;
  modalDiaEdicion = dia;
  modalIdxEdicion = idx;
  
  const modal = $('modal-editar-novedad');
  const sub = $('modal-novedad-sub');
  const codigo = $('modal-novedad-codigo');
  const obs = $('modal-novedad-obs');
  
  sub.textContent = `Día ${dia} — ${agente.apellidosNombres}`;
  codigo.value = (agente.novedadesPorDia && agente.novedadesPorDia[String(dia)]) || '';
  obs.value = agente.observaciones || '';
  
  hide('modal-novedad-error');
  
  modal.style.display = 'flex';
  codigo.focus();
  codigo.select();
}

function cerrarModalNovedad() {
  $('modal-editar-novedad').style.display = 'none';
  hide('modal-novedad-error');
  modalAgenteEdicion = null;
  modalDiaEdicion = null;
  modalIdxEdicion = null;
}

async function guardarNovedad() {
  if (!modalAgenteEdicion) return;
  
  const codigo = $('modal-novedad-codigo').value.trim();
  const obs = $('modal-novedad-obs').value.trim();
  
  if (!codigo) {
    mostrarErrorCodigo('El código no puede estar vacío');
    return;
  }
  
  // Normalizar y validar
  const codigoNorm = normalizarCodigo(codigo);
  
  if (!validarCodigo(codigoNorm)) {
    mostrarErrorCodigo(`"${codigo}" no es un código válido`);
    return;
  }
  
  // Actualizar en memoria
  if (!modalAgenteEdicion.novedadesPorDia) {
    modalAgenteEdicion.novedadesPorDia = {};
  }
  modalAgenteEdicion.novedadesPorDia[String(modalDiaEdicion)] = codigoNorm;
  modalAgenteEdicion.observaciones = obs;
  
  // Guardar en Firestore
  try {
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: novedadesActuales.agentes,
      ultimaModificacion: new Date()
    });
    
    // Log auditoría
    await registrarEnAuditoria(
      'modificar_novedad',
      areaActual,
      usuario.email,
      modalDiaEdicion,
      mesActual,
      { codigo: codigoNorm, observaciones: obs },
      `Modificación: ${modalAgenteEdicion.apellidosNombres} - Día ${modalDiaEdicion} - ${codigoNorm}`
    );
    
    // Actualizar tabla
    renderizarTablaNovedades(new Date().getDate());
    verificarDiasPendientes();
    
    toast('✅ Novedad guardada', 'ok');
    cerrarModalNovedad();
    
  } catch(e) {
    console.error('Error guardando:', e);
    mostrarErrorCodigo('Error guardando: ' + e.message);
  }
}

function mostrarErrorCodigo(msg) {
  const error = $('modal-novedad-error');
  error.textContent = msg;
  show('modal-novedad-error');
}

function cerrarErrorCodigo() {
  $('modal-error-codigo').style.display = 'none';
}

/* ═════════════════════════════════════════
   ACCIONES: Llenar S/N, Exportar
═════════════════════════════════════════ */

async function llenarSinNovedadHoy() {
  const hoy = new Date().getDate();
  
  try {
    // Llenar todos los agentes con S/N
    if (novedadesActuales.agentes) {
      novedadesActuales.agentes.forEach(agente => {
        if (!agente.novedadesPorDia) agente.novedadesPorDia = {};
        agente.novedadesPorDia[String(hoy)] = 'S/N';
      });
    }
    
    // Guardar en Firestore
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: novedadesActuales.agentes,
      ultimaModificacion: new Date()
    });
    
    // Log
    await registrarEnAuditoria(
      'rellenar_sin_novedad',
      areaActual,
      usuario.email,
      hoy,
      mesActual,
      { cantidadAgentes: novedadesActuales.agentes.length },
      `Auto-relleno S/N: ${novedadesActuales.agentes.length} agentes - Día ${hoy}`
    );
    
    renderizarTablaNovedades(hoy);
    toast('✅ Se llenó "Sin Novedad" para todos los agentes de hoy', 'ok');
    
  } catch(e) {
    console.error('Error:', e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function exportarMesActual() {
  try {
    toast('⏳ Generando CSV...', 'ok');
    
    // Crear CSV
    let csv = 'Nº,CÓDIGO,GRADO,APELLIDOS Y NOMBRES,CÉDULA';
    for (let dia = 1; dia <= 31; dia++) {
      csv += `,${dia}`;
    }
    csv += ',OBSERVACIÓN\n';
    
    if (novedadesActuales.agentes) {
      novedadesActuales.agentes.forEach(agente => {
        csv += `"${agente.numero || ''}","${agente.codigo || ''}","${agente.grado || ''}","${agente.apellidosNombres || ''}","${agente.cedula || ''}"`;
        for (let dia = 1; dia <= 31; dia++) {
          const valor = agente.novedadesPorDia && agente.novedadesPorDia[String(dia)] ? agente.novedadesPorDia[String(dia)] : '';
          csv += `,"${valor}"`;
        }
        csv += `,"${agente.observaciones || ''}"\n`;
      });
    }
    
    // Descargar
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', `novedades-${areaActual}-${mesActual}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    toast('✅ Archivo descargado', 'ok');
    
  } catch(e) {
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Importar BD
═════════════════════════════════════════ */

async function importarBaseDatos() {
  try {
    if (!esAdmin()) {
      toast('❌ Solo admin puede importar datos', 'err');
      return;
    }
    
    const coleccion = $('import-coleccion').value.trim();
    const fileInput = $('import-csv');
    
    if (!coleccion) {
      toast('⚠️ Ingresa un nombre para la colección', 'warn');
      return;
    }
    
    if (!fileInput.files || fileInput.files.length === 0) {
      toast('⚠️ Selecciona un archivo CSV', 'warn');
      return;
    }
    
    toast('⏳ Procesando archivo...', 'ok');
    
    // Leer CSV
    const file = fileInput.files[0];
    const text = await file.text();
    const lineas = text.split('\n').filter(l => l.trim());
    
    if (lineas.length < 2) {
      toast('❌ El archivo CSV está vacío o mal formateado', 'err');
      return;
    }
    
    // Parsear líneas (saltar encabezado)
    const datos = {};
    for (let i = 1; i < lineas.length; i++) {
      const partes = lineas[i].split(',').map(p => p.replace(/^"|"$/g, '').trim());
      if (partes.length < 6) continue;
      
      const area = partes[5] || 'SIN ÁREA';
      if (!datos[area]) datos[area] = [];
      
      datos[area].push({
        numero: partes[0],
        codigo: partes[1],
        grado: partes[2],
        apellidosNombres: partes[3],
        cedula: partes[4],
        novedadesPorDia: Array.from({length: 31}, (_, i) => 'S/N').reduce((o, v, i) => ({...o, [String(i+1)]: v}), {}),
        observaciones: ''
      });
    }
    
    // Guardar en Firestore
    const dateParts = obtenerFechaParts();
    const periodo = dateParts.periodo;
    
    for (const [area, agentes] of Object.entries(datos)) {
      const novedadesRef = window._fb.doc(db, 'novedades', area, periodo, 'datos');
      await window._fb.setDoc(novedadesRef, {
        agentes: agentes,
        estado: 'activo',
        diasBloqueados: [],
        diasNoCompletados: Array.from({length: 31}, (_, i) => i + 1),
        fechaCreacion: new Date(),
        ultimaModificacion: new Date()
      });
    }
    
    // Log
    await registrarEnAuditoria(
      'importar_bd',
      null,
      null,
      null,
      null,
      {
        coleccion: coleccion,
        totalRegistros: Object.values(datos).reduce((sum, arr) => sum + arr.length, 0),
        areas: Object.keys(datos)
      },
      `Importación de BD: ${coleccion}`
    );
    
    const resultado = $('import-resultado');
    resultado.innerHTML = `
      ✅ <strong>Importación exitosa</strong><br>
      Colección: ${coleccion}<br>
      Áreas: ${Object.keys(datos).length}<br>
      Registros: ${Object.values(datos).reduce((sum, arr) => sum + arr.length, 0)}
    `;
    show('import-resultado');
    
    toast('✅ Base de datos importada', 'ok');
    
  } catch(e) {
    console.error('Error importando:', e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Gestionar Accesos
═════════════════════════════════════════ */

async function cargarAccesos() {
  try {
    const accesoSnapshot = await window._fb.getDocs(window._fb.collection(db, 'accesos'));
    const lista = $('accesos-lista');
    const vacio = $('accesos-vacio');
    
    lista.innerHTML = '';
    
    if (accesoSnapshot.empty) {
      show('accesos-vacio');
      return;
    }
    
    hide('accesos-vacio');
    
    accesoSnapshot.forEach(doc => {
      const data = doc.data();
      const div = document.createElement('div');
      div.style.cssText = 'display:flex;align-items:center;gap:12px;padding:12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;';
      
      div.innerHTML = `
        <div style="flex:1;">
          <div style="font-weight:600;font-size:13px;">${data.correo}</div>
          <div style="font-size:11px;color:var(--txt2);">${data.area}</div>
        </div>
        <button class="btn-acc btn-acc-blue" onclick="editarAcceso('${doc.id}')">✎</button>
        <button class="btn-acc btn-acc-red" onclick="eliminarAcceso('${doc.id}')">🗑</button>
      `;
      lista.appendChild(div);
    });
    
  } catch(e) {
    console.error('Error cargando accesos:', e);
    toast('Error: ' + e.message, 'err');
  }
}

function mostrarFormAcceso() {
  const correo = prompt('Correo (ej: usuario@cte.ec):');
  if (!correo) return;
  
  const select = document.createElement('select');
  AREAS.forEach(area => {
    const opt = document.createElement('option');
    opt.value = area;
    opt.textContent = area;
    select.appendChild(opt);
  });
  
  const modal = document.createElement('div');
  modal.innerHTML = `
    <div style="position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:10000;">
      <div style="background:var(--white);border-radius:12px;padding:20px;max-width:400px;">
        <h3>Nuevo Acceso</h3>
        <p style="font-size:12px;color:var(--txt2);margin:12px 0;">Selecciona el área para: <strong>${correo}</strong></p>
        <select id="area-select-modal" class="form-select" style="width:100%;margin-bottom:16px;">
          ${AREAS.map(a => `<option value="${a}">${a}</option>`).join('')}
        </select>
        <div style="display:flex;gap:8px;">
          <button class="btn-acc btn-acc-ghost" onclick="this.parentElement.parentElement.parentElement.remove()">Cancelar</button>
          <button class="btn-acc btn-acc-green" onclick="guardarAcceso('${correo}', document.getElementById('area-select-modal').value)">Guardar</button>
        </div>
      </div>
    </div>
  `;
  document.body.appendChild(modal);
}

async function guardarAcceso(correo, area) {
  try {
    await window._fb.addDoc(window._fb.collection(db, 'accesos'), {
      correo: correo.toLowerCase(),
      area: area,
      estado: true,
      fechaCreacion: new Date(),
      ultimaEdicion: new Date()
    });
    
    await registrarEnAuditoria('crear_acceso', area, correo, null, null, {}, `Nuevo acceso: ${correo} → ${area}`);
    
    toast('✅ Acceso creado', 'ok');
    cargarAccesos();
    document.querySelector('div[style*="position:fixed"]').remove();
    
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function eliminarAcceso(docId) {
  if (!confirm('¿Eliminar este acceso?')) return;
  try {
    await window._fb.deleteDoc(window._fb.doc(db, 'accesos', docId));
    toast('✅ Acceso eliminado', 'ok');
    cargarAccesos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Auditoría
═════════════════════════════════════════ */

async function cargarAuditoria() {
  try {
    const auditSnapshot = await window._fb.getDocs(window._fb.collection(db, 'auditoria'));
    const tbody = $('auditoria-body');
    const vacio = $('auditoria-vacio');
    
    tbody.innerHTML = '';
    
    if (auditSnapshot.empty) {
      show('auditoria-vacio');
      return;
    }
    
    hide('auditoria-vacio');
    
    auditSnapshot.forEach(doc => {
      const data = doc.data();
      const tr = document.createElement('tr');
      
      const fecha = data.timestamp ? data.timestamp.toDate ? data.timestamp.toDate().toLocaleString() : new Date(data.timestamp).toLocaleString() : '';
      
      tr.innerHTML = `
        <td style="font-size:10px;">${fecha}</td>
        <td style="font-size:10px;">${data.admin || '—'}</td>
        <td style="font-size:10px;">${data.accion || '—'}</td>
        <td style="font-size:10px;">${data.descripcion || '—'}</td>
      `;
      tbody.appendChild(tr);
    });
    
  } catch(e) {
    console.error('Error:', e);
    toast('Error cargando auditoría: ' + e.message, 'err');
  }
}

async function filtrarAuditoria() {
  toast('⏳ Filtrado en desarrollo...', 'ok');
  // Implementar filtros más adelante
}

async function limpiarAuditoria() {
  if (!confirm('¿Eliminar TODO el historial de auditoría? Esta acción no se puede deshacer.')) return;
  try {
    const auditSnapshot = await window._fb.getDocs(window._fb.collection(db, 'auditoria'));
    const batch = window._fb.writeBatch(db);
    
    auditSnapshot.forEach(doc => {
      batch.delete(doc.ref);
    });
    
    await batch.commit();
    toast('✅ Auditoría limpiada', 'ok');
    cargarAuditoria();
    
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Desbloqueos
═════════════════════════════════════════ */

async function cargarDesbloqueos() {
  try {
    const solicitudes = await window._fb.getDocs(window._fb.collection(db, 'solicitudes'));
    const lista = $('desbloqueos-lista');
    const vacio = $('desbloqueos-vacio');
    
    lista.innerHTML = '';
    
    let pendientes = 0, aprobadas = 0, rechazadas = 0;
    
    if (solicitudes.empty) {
      show('desbloqueos-vacio');
      $('stat-pendientes').textContent = '0';
      $('stat-aprobadas').textContent = '0';
      $('stat-rechazadas').textContent = '0';
      return;
    }
    
    hide('desbloqueos-vacio');
    
    solicitudes.forEach(doc => {
      const data = doc.data();
      if (data.estado === 'pendiente') pendientes++;
      else if (data.estado === 'aprobada') aprobadas++;
      else if (data.estado === 'rechazada') rechazadas++;
      
      const div = document.createElement('div');
      div.style.cssText = 'padding:12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);margin-bottom:8px;';
      
      const badge = data.estado === 'pendiente' ? '🔄' : data.estado === 'aprobada' ? '✅' : '❌';
      
      div.innerHTML = `
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="font-weight:600;">${badge} ${data.correoUsuario}</div>
            <div style="font-size:11px;color:var(--txt2);">${data.area} — ${data.tipo === 'desbloqueo_dia' ? 'Día ' + data.dia : 'Mes ' + data.mes}</div>
          </div>
          ${data.estado === 'pendiente' ? `
            <div style="display:flex;gap:6px;">
              <button class="btn-acc btn-acc-green" onclick="aprobarDesbloqueo('${doc.id}')">Aprobar</button>
              <button class="btn-acc btn-acc-red" onclick="rechazarDesbloqueo('${doc.id}')">Rechazar</button>
            </div>
          ` : ''}
        </div>
      `;
      lista.appendChild(div);
    });
    
    $('stat-pendientes').textContent = pendientes;
    $('stat-aprobadas').textContent = aprobadas;
    $('stat-rechazadas').textContent = rechazadas;
    
  } catch(e) {
    console.error('Error:', e);
  }
}

async function aprobarDesbloqueo(docId) {
  try {
    await window._fb.updateDoc(window._fb.doc(db, 'solicitudes', docId), {
      estado: 'aprobada',
      fechaRespuesta: new Date()
    });
    toast('✅ Desbloqueo aprobado', 'ok');
    cargarDesbloqueos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function rechazarDesbloqueo(docId) {
  const razon = prompt('Motivo del rechazo:');
  if (!razon) return;
  try {
    await window._fb.updateDoc(window._fb.doc(db, 'solicitudes', docId), {
      estado: 'rechazada',
      fechaRespuesta: new Date(),
      respuestaAdmin: razon
    });
    toast('❌ Desbloqueo rechazado', 'ok');
    cargarDesbloqueos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   ENVÍOS (Funciones del sistema actual)
═════════════════════════════════════════ */

function actualizarPreviewArchivo() {
  const input = $('file-input');
  const preview = $('file-preview');
  const nombre = $('file-preview-nombre');
  const peso = $('file-preview-peso');
  
  if (!input.files || input.files.length === 0) {
    preview.style.display = 'none';
    return;
  }
  
  const file = input.files[0];
  const sizeMB = (file.size / 1024 / 1024).toFixed(2);
  
  nombre.textContent = '📦 ' + file.name;
  peso.textContent = sizeMB + ' MB';
  preview.style.display = 'flex';
}

function limpiarArchivo() {
  $('file-input').value = '';
  $('file-preview').style.display = 'none';
}

async function subirEnvio() {
  try {
    const detalle = $('detalle-envio').value.trim();
    const areaSelect = $('area-select');
    const area = areaSelect.value;
    const fileInput = $('file-input');
    
    if (!detalle) {
      toast('⚠️ Ingresa los detalles del envío', 'warn');
      return;
    }
    if (!area) {
      toast('⚠️ Selecciona un área', 'warn');
      return;
    }
    if (!fileInput.files || fileInput.files.length === 0) {
      toast('⚠️ Selecciona un archivo', 'warn');
      return;
    }
    
    const file = fileInput.files[0];
    const sizeMB = (file.size / 1024 / 1024).toFixed(2);
    
    if (!['application/x-rar-compressed', 'application/zip', 'application/x-zip-compressed'].includes(file.type) &&
        !file.name.endsWith('.rar') && !file.name.endsWith('.zip')) {
      toast('❌ Solo se aceptan archivos .rar o .zip', 'err');
      return;
    }
    
    toast('⏳ Subiendo archivo...', 'ok');
    
    // Guardar registro en Firestore
    await window._fb.addDoc(window._fb.collection(db, 'envios'), {
      usuario: usuario.email,
      nombre: usuario.nombre,
      archivo: file.name,
      tamaño: sizeMB + ' MB',
      area: area,
      detalle: detalle,
      estado: 'completado',
      fechaEnvio: new Date()
    });
    
    // Enviar correo
    const datos = {
      usuario: usuario.nombre || usuario.email,
      archivo: file.name,
      area: area,
      tamaño: sizeMB + ' MB',
      correo: usuario.email,
      adminCorreo: 'sis.cte1@gmail.com'
    };
    
    try {
      await fetch(GAS_MAILER_URL, {
        method: 'POST',
        body: new URLSearchParams({ data: JSON.stringify(datos) })
      });
    } catch(e) {
      console.warn('Aviso: no se pudo enviar correo:', e);
    }
    
    // Mostrar éxito
    $('exito-archivo').textContent = file.name;
    $('exito-area').textContent = area;
    $('exito-detalle').textContent = detalle;
    $('exito-email').textContent = usuario.email;
    
    // Limpiar y ir a éxito
    limpiarArchivo();
    $('detalle-envio').value = '';
    areaSelect.value = '';
    
    ir('vista-exito');
    toast('✅ Envío registrado exitosamente', 'ok');
    
  } catch(e) {
    console.error('Error:', e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   INICIALIZACIÓN PANEL ADMIN
═════════════════════════════════════════ */

document.addEventListener('DOMContentLoaded', async () => {
  // Esperar a que Firebase esté listo
  await _firebaseReady;
  
  // Cargar datos admin cuando se abre panel
  const adminTabs = document.querySelectorAll('.admin-tab');
  adminTabs.forEach(tab => {
    tab.addEventListener('click', async () => {
      const tabName = tab.dataset.tab;
      if (tabName === 'accesos' && esAdmin()) {
        cargarAccesos();
      } else if (tabName === 'auditoria' && esAdmin()) {
        cargarAuditoria();
      } else if (tabName === 'desbloqueos' && esAdmin()) {
        cargarDesbloqueos();
      }
    });
  });
});
