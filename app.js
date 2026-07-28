/* ══════════════════════════════════════════════════════════
   PORTAL SISCTE — app.js  v5.5
   Cambios v5.5:
     • Fix real del mailer: payload enviado como parámetro GET (URL encoded)
     • GAS lee e.parameter.data en doPost/doGet — compatible con no-cors
     • Correos llegan tanto al usuario como al administrador
   Cambios v5.3:
     • Reemplazado EmailJS por Google Apps Script Mailer
     • Sin dependencias externas para correos
     • Correos HTML enriquecidos enviados desde sis.cte1@gmail.com
   Cambios v5.2:
     • Eliminado botón "Actualizar" del nav y de Mis Envíos
     • iniciarLimpiezaDuplicados() limpia la UI de forma síncrona y garantizada
     • Eliminadas funciones refrescarTodo / refrescarMisEnvios
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

/* ── GAS Mailer — Notificaciones por correo ──────────── */
const GAS_MAILER_URL = 'https://script.google.com/macros/s/AKfycbxVjHN7-NeDy2e0mhZ5RPIoqnUhzt86sW6v1HJlhmMaBtI-3PJlM2ZuSI1Wdvtf2jR8/exec';

/* ── Google Drive ────────────────────────────────────── */
const GDRIVE_CONFIG = {
  clientId: '861145504172-qf14jcon0msi3hl3l5cn5j5eard2gdvb.apps.googleusercontent.com',
  scope: 'https://www.googleapis.com/auth/drive'
};

const GDRIVE_CARPETA_GENERAL      = '1EBYsTtNi7JMTOYqKSnjFWnipmaq1L_LU';
const GDRIVE_CARPETA_COMPROBANTES = '1sZnOusOY3mT-nidmdlveKaj3FxX5WG5_';

/* ── Admin ───────────────────────────────────────────── */
const ADMIN_EMAILS = [
  "sis.cte1@gmail.com"
];

const AREAS = [
  "SUB ZONA GUAYAS","ZONA 8",
  "CEBAF AREA COMPUTO NACIONAL",
  "PROV_PICHINCHA","PROV_MANABI","PROV_SANTO DOMINGO",
  "PROV_LOS RIOS","PROV_BOLIVAR","PROV_SANTA ELENA",
  "PROV_AZUAY","PROV_EL ORO",
  "UREM","OIAT","EDU_VIAL","CRV","ECU-911"
];

/* ── Códigos de Novedad (8 exactos) ─────────────────── */
const CODIGOS_VALIDOS = ["S/N", "OA", "X", "CS", "B", "Li", "V", "PE"];
const CODIGOS_DESC = {
  "S/N": "SIN NOVEDAD (normal)",
  "OA":  "OTRA ÁREA — Formulario Único de Traslado (FUT)",
  "X":   "AUSENCIA INJUSTIFICADA",
  "CS":  "COMISIÓN DE SERVICIO",
  "B":   "BAJA (Fallecido, Destitución, Renuncia)",
  "Li":  "LICENCIA (Paternidad, Matrimonio, Calamidad, Maternidad)",
  "V":   "VACACIONES",
  "PE":  "PERMISO"
};

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
    const { initializeApp }
      = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js");
    const { getFirestore, collection, addDoc, getDocs, orderBy, query, doc, getDoc, setDoc, updateDoc, deleteDoc, where, limit, startAfter, writeBatch }
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

    onAuthStateChanged(auth, async u => {
      if (u) {
        usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
        await cargarPermisoUsuario();
        actualizarNav();

        // Novedades/Envíos son para personal operativo (con área asignada en Accesos).
        // Si la persona tiene algún permiso del Panel de Control pero NO tiene área
        // asignada, no es personal operativo — no debe ver esas dos pestañas,
        // sin importar qué tipo de permiso se le haya dado.
        const tieneArea = permisoUsuario ? await usuarioTieneAreaAsignada() : true;
        const debeVerOperativas = esAdmin() || tieneArea;

        debeVerOperativas ? show('nb-novedades') : hide('nb-novedades');
        debeVerOperativas ? show('nb-envios') : hide('nb-envios');
        tieneAccesoPanel() ? show('nb-admin') : hide('nb-admin');   // Panel de control: admin o con permiso
        (esSupervisor() || tienePermisoAccion('actividad_ver')) ? show('nb-reportes') : hide('nb-reportes');

        if (!debeVerOperativas && tieneAccesoPanel()) {
          irAdmin();
        } else if (!debeVerOperativas && (esSupervisor() || tienePermisoAccion('actividad_ver'))) {
          irReportes();
        } else {
          irNovedades();
        }
      } else {
        usuario = null;
        permisoUsuario = null;
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
   AUTH — solo Google
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
      if (['auth/popup-blocked','auth/popup-closed-by-user','auth/cancelled-popup-request']
          .includes(popupErr.code)) {
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

const esAdmin = () =>
  usuario && ADMIN_EMAILS.map(x => x.toLowerCase()).includes(usuario.email.toLowerCase());

/* ══════════════════════════════════
   PERMISOS — acceso parcial al Panel de Control / supervisor de solo lectura
══════════════════════════════════ */

// Catálogo de acciones concretas que se pueden delegar, agrupadas por pestaña.
// key = se usa como identificador en Firestore y en los atributos data-permiso del HTML.
const PERMISOS_DISPONIBLES = [
  { tab: 'envios', tabLabel: '📤 Envíos realizados', acciones: [
    { key: 'envios_ver',                label: 'Ver envíos y estadísticas' },
    { key: 'envios_exportar',           label: 'Exportar Excel (todo / filtrado)' },
    { key: 'envios_archivar',           label: 'Archivar mes' },
    { key: 'envios_eliminar_duplicados',label: 'Eliminar registros de la BD' },
  ]},
  { tab: 'importar', tabLabel: '📥 Importar BD', acciones: [
    { key: 'importar_bd',               label: 'Importar base de datos (Excel/CSV)' },
    { key: 'importar_eliminar_area_mes',label: 'Eliminar Novedades de un área/mes puntual' },
    { key: 'importar_borrar_todo',      label: 'Borrar TODA la base de Novedades' },
    { key: 'importar_ver_personal',     label: 'Ver Base de Personal' },
    { key: 'importar_editar_personal',  label: 'Agregar / editar / eliminar personal' },
    { key: 'importar_cambio_lote',      label: 'Cambio de área en lote' },
  ]},
  { tab: 'accesos', tabLabel: '🔐 Accesos', acciones: [
    { key: 'accesos_ver',               label: 'Ver accesos' },
    { key: 'accesos_gestionar',         label: 'Crear / editar / eliminar accesos' },
  ]},
  { tab: 'auditoria', tabLabel: '📋 Auditoría', acciones: [
    { key: 'auditoria_ver',             label: 'Ver auditoría' },
    { key: 'auditoria_limpiar',         label: 'Limpiar historial de auditoría' },
  ]},
  { tab: 'desbloqueos', tabLabel: '🔓 Desbloqueos', acciones: [
    { key: 'desbloqueos_ver',           label: 'Ver solicitudes de desbloqueo' },
    { key: 'desbloqueos_aprobar',       label: 'Aprobar / rechazar solicitudes' },
    { key: 'desbloqueos_directo',       label: 'Desbloqueo directo (sin esperar solicitud)' },
  ]},
  { tab: 'resumen', tabLabel: '📊 Resumen General', acciones: [
    { key: 'resumen_ver',               label: 'Ver resumen general' },
    { key: 'resumen_exportar',          label: 'Exportar resumen a Excel' },
  ]},
  { tab: 'actividad', tabLabel: '📈 Actividad del Administrador', acciones: [
    { key: 'actividad_ver',             label: 'Ver actividad del administrador (auditoría resumida) y descargarla' },
  ]},
];

let permisoUsuario = null; // { tipo: 'parcial'|'supervisor', acciones: [...] } o null

async function cargarPermisoUsuario() {
  permisoUsuario = null;
  if (!usuario || esAdmin()) return; // el superadmin no necesita permiso, ya tiene todo
  try {
    const ref = window._fb.doc(db, 'permisos_panel', usuario.email.toLowerCase());
    const snap = await window._fb.getDoc(ref);
    if (snap.exists()) permisoUsuario = snap.data();
  } catch(e) {
    console.warn('No se pudo cargar el permiso del usuario:', e);
  }
}

const tienePermisoAccion = (key) => {
  if (esAdmin()) return true;
  if (permisoUsuario?.tipo === 'parcial') return (permisoUsuario.acciones || []).includes(key);
  // El supervisor puede ver y exportar cualquier cosa, pero nunca crear/editar/eliminar/aprobar/importar
  if (permisoUsuario?.tipo === 'supervisor') return key.endsWith('_ver') || key.endsWith('_exportar');
  return false;
};

// Una pestaña se muestra si el usuario tiene AL MENOS una acción de ese grupo
// (el supervisor ve todas las pestañas sustantivas, siempre en modo solo lectura)
const tabPermitido = (tabName) => {
  if (esAdmin()) return true;
  if (permisoUsuario?.tipo === 'supervisor') return true;
  if (permisoUsuario?.tipo !== 'parcial') return false;
  const grupo = PERMISOS_DISPONIBLES.find(g => g.tab === tabName);
  if (!grupo) return false;
  return grupo.acciones.some(a => (permisoUsuario.acciones || []).includes(a.key));
};

const tieneAccesoPanel = () =>
  esAdmin() || (permisoUsuario && (permisoUsuario.tipo === 'parcial' || permisoUsuario.tipo === 'supervisor'));
const esSupervisor = () => !esAdmin() && permisoUsuario && permisoUsuario.tipo === 'supervisor';

async function usuarioTieneAreaAsignada() {
  try {
    const q = window._fb.query(
      window._fb.collection(db, 'accesos'),
      window._fb.where('correo', '==', usuario.email.toLowerCase())
    );
    const snap = await window._fb.getDocs(q);
    return !snap.empty;
  } catch(e) {
    return false;
  }
}

// Oculta/deshabilita cualquier elemento con data-permiso="clave" si el usuario no la tiene
function aplicarPermisosBotones() {
  if (esAdmin()) return; // el admin siempre ve todo
  document.querySelectorAll('[data-permiso]').forEach(el => {
    const claves = el.dataset.permiso.split(',').map(k => k.trim());
    const permitido = claves.some(k => tienePermisoAccion(k));
    el.style.display = permitido ? '' : 'none';
  });
}

/* ══════════════════════════════════
   DOM HELPERS
══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(!e) return; e.style.display = ['nav-sesion','nav-guest','nav-right'].includes(id) ? 'flex' : 'block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none'; };
const hideAll = () => ['vista-login','vista-novedades','vista-envios','vista-exito','vista-admin','vista-reportes'].forEach(hide);

function ir(v) {
  hideAll();
  const el = $(v); if (!el) return;
  el.style.display = v === 'vista-login' ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-envios'||v==='vista-exito') $('nb-envios')?.classList.add('active');
  if (v==='vista-novedades') $('nb-novedades')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
  if (v==='vista-reportes') $('nb-reportes')?.classList.add('active');
}

function irNovedades() { ir('vista-novedades'); cargarNovedadesActuales(); }
function irReportes() {
  ir('vista-reportes');
  cargarReportesActividad();
  poblarSelectoresResumen('rep-resumen');
}

function irAdmin() {
  if (!tieneAccesoPanel()) return;
  ir('vista-admin');
  aplicarVisibilidadTabsAdmin();
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
    esAdmin() ? show('nb-envios') : hide('nb-envios');
    tieneAccesoPanel() ? show('nb-admin') : hide('nb-admin');
    (esSupervisor() || tienePermisoAccion('actividad_ver')) ? show('nb-reportes') : hide('nb-reportes');
  } else {
    hide('nav-sesion'); show('nav-guest'); hide('nb-admin');
  }
}

function resetBtn() {
  const btn = $('btn-enviar'); if (!btn) return;
  btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>
    </svg> Registrar Envío`;
  actualizarBotonEnviar();
}

/* ══════════════════════════════════
   MÓDULO NOVEDADES — Utilidades
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

/* ═════════════════════════════════════════
   MÓDULO NOVEDADES — Cargar datos actuales
═════════════════════════════════════════ */

function obtenerPeriodoAnterior(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  const d = new Date(anio, mes - 2, 1); // mes-1 es el mes actual (0-index), -1 más = mes anterior
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

async function obtenerAreasNovedades() {
  try {
    const ref = window._fb.doc(db, 'sistema', 'areas_novedades');
    const snap = await window._fb.getDoc(ref);
    if (snap.exists() && snap.data().lista && snap.data().lista.length > 0) {
      return snap.data().lista;
    }
  } catch(e) {
    console.warn('No se pudo obtener la lista real de áreas, usando AREAS por defecto:', e);
  }
  return AREAS; // respaldo si todavía no se importó nada
}

async function poblarSelectorAreaAdmin() {
  const cont = $('admin-selector-area-novedades');
  const sel = $('select-area-admin-novedades');
  if (!cont || !sel) return;
  show('admin-selector-area-novedades');
  cont.style.display = 'block';

  const areasReales = await obtenerAreasNovedades();

  if (sel.dataset.poblado !== '1') {
    sel.innerHTML = '';
    areasReales.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      sel.appendChild(opt);
    });
    sel.dataset.poblado = '1';
    if (!areaActual || !areasReales.includes(areaActual)) areaActual = areasReales[0];
    sel.value = areaActual;
    sel.addEventListener('change', () => {
      areaActual = sel.value;
      cargarNovedadesActuales();
    });
  } else {
    sel.value = areaActual;
  }
}

async function cargarNovedadesActuales() {
  try {
    const dateParts = obtenerFechaParts();
    const periodo = dateParts.periodo;
    const diaHoy = dateParts.dia;

    if (esAdmin()) {
      // El admin tiene acceso total: elige el área a gestionar, sin requerir estar en "accesos"
      await poblarSelectorAreaAdmin();
    } else {
      hide('admin-selector-area-novedades');
      // Obtener area del usuario desde accesos
      const accesoRef = window._fb.collection(db, 'accesos');
      const q = window._fb.query(accesoRef, window._fb.where('correo', '==', usuario.email));
      const querySnapshot = await window._fb.getDocs(q);

      if (querySnapshot.empty) {
        toast('❌ Su correo no está configurado en el sistema. Contacte a soporte.', 'err');
        hide('tabla-novedades-container');
        hide('cierre-mes-container');
        hide('novedades-top-controles');
        show('tabla-cargando');
        $('tabla-cargando').textContent = '❌ Correo no configurado';
        return;
      }

      areaActual = querySnapshot.docs[0].data().area;
    }

    mesActual = periodo;

    // Actualizar hero
    $('hero-area').textContent = areaActual;
    $('hero-mes').textContent = obtenerNombreMes(dateParts.mes);
    $('info-dia-actual').textContent = `Hoy es día ${diaHoy}`;

    // ── Verificar si hay un mes anterior sin cerrar ──
    const periodoAnterior = obtenerPeriodoAnterior(periodo);
    const refAnterior = window._fb.doc(db, 'novedades', areaActual, periodoAnterior, 'datos');
    const docAnterior = await window._fb.getDoc(refAnterior);

    // Panel "Generar reporte":
    // - Admin: acceso total, cualquier área/mes/año, en cualquier momento.
    // - Usuario regular: solo se habilita al entrar al mes siguiente, y únicamente
    //   para generar el reporte del mes recién culminado (sin poder elegir otro).
    if (esAdmin()) {
      show('admin-generar-reporte');
      $('admin-generar-reporte').style.display = 'block';
      $('reporte-prueba-titulo').textContent = '🧪 Generar reporte (de prueba — cualquier momento)';
      $('reporte-prueba-desc').textContent = 'Genere el Excel/PDF de su área y mes que quiera para probar, sin esperar al cierre de mes. No afecta el estado del mes ni bloquea nada — lo puede hacer las veces que necesite.';
      show('reporte-prueba-selectores');
      $('reporte-prueba-selectores').style.display = 'grid';
      $('reporte-prueba-btn-txt').textContent = '📄 Generar Excel + PDF';
      poblarSelectoresReportePrueba();
    } else if (docAnterior.exists() && (docAnterior.data().agentes || []).length > 0) {
      show('admin-generar-reporte');
      $('admin-generar-reporte').style.display = 'block';
      $('reporte-prueba-titulo').textContent = '📄 Generar reporte';
      $('reporte-prueba-desc').textContent = `Puede generar el Excel/PDF de ${obtenerNombreMes(periodoAnterior.split('-')[1])} ${periodoAnterior.split('-')[0]} de su área, el mes que acaba de culminar.`;
      hide('reporte-prueba-selectores');
      $('reporte-prueba-selectores').style.display = 'none';
      $('reporte-prueba-btn-txt').textContent = '📄 Generar reporte';
      poblarSelectoresReportePrueba();
      // Fijar el período al mes recién culminado — el usuario no puede elegir otro
      $('reporte-prueba-mes').value = periodoAnterior.split('-')[1];
      $('reporte-prueba-anio').value = periodoAnterior.split('-')[0];
    } else {
      hide('admin-generar-reporte');
      $('admin-generar-reporte').style.display = 'none';
    }

    if (docAnterior.exists() && docAnterior.data().estado !== 'cerrado' && (docAnterior.data().agentes || []).length > 0) {
      mostrarCierreMes(areaActual, periodoAnterior, docAnterior.data());
      return;
    }
    ocultarPantallaCierreMes();

    // Cargar novedades del mes actual
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, periodo, 'datos');
    const novedadesDoc = await window._fb.getDoc(novedadesRef);

    if (!novedadesDoc.exists()) {
      // Crear estructura inicial
      await window._fb.setDoc(novedadesRef, {
        agentes: [],
        estado: 'activo',
        diasBloqueados: [],
        diasDesbloqueados: [],
        diasNoCompletados: Array.from({length: 31}, (_, i) => i + 1),
        fechaCreacion: new Date(),
        ultimaModificacion: new Date()
      });
      novedadesActuales = { agentes: [], diasDesbloqueados: [] };
    } else {
      novedadesActuales = novedadesDoc.data();
    }

    // Renderizar tabla
    renderizarTablaNovedades(diaHoy);

    // Verificar días pendientes
    verificarDiasPendientes();

    show('novedades-top-controles');
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

/* ═════════════════════════════════════════
   Agrupar agentes duplicados por código válido
   o por nombre (cubre el caso de campos
   código/grado invertidos por una mala carga)
═════════════════════════════════════════ */
function agruparAgentesPorIdentidad(agentes) {
  const n = agentes.length;
  const parent = Array.from({ length: n }, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }

  const porCodigo = {};
  const porNombre = {};

  agentes.forEach((a, i) => {
    const codigo = String(a.codigo || '').trim();
    const esCodigoValido = /^\d+$/.test(codigo);
    const nombre = String(a.apellidosNombres || '').trim().toUpperCase().replace(/\s+/g, ' ');

    if (esCodigoValido) {
      if (porCodigo[codigo] !== undefined) union(i, porCodigo[codigo]);
      else porCodigo[codigo] = i;
    }
    if (nombre) {
      if (porNombre[nombre] !== undefined) union(i, porNombre[nombre]);
      else porNombre[nombre] = i;
    }
  });

  const grupos = {};
  agentes.forEach((a, i) => {
    const raiz = find(i);
    if (!grupos[raiz]) grupos[raiz] = [];
    grupos[raiz].push(a);
  });

  return Object.values(grupos);
}

/* ═════════════════════════════════════════
   Ordenar agentes por código (numérico, menor a mayor)
═════════════════════════════════════════ */
function compararPorCodigo(codigoA, codigoB) {
  const a = parseInt(String(codigoA).replace(/\D/g, ''), 10);
  const b = parseInt(String(codigoB).replace(/\D/g, ''), 10);
  if (isNaN(a) && isNaN(b)) return 0;
  if (isNaN(a)) return 1;
  if (isNaN(b)) return -1;
  return a - b;
}
function ordenarAgentesPorCodigo(agentes) {
  return [...(agentes || [])].sort((x, y) => compararPorCodigo(x.codigo, y.codigo));
}

function renderizarTablaNovedades(diaHoy) {
  const tabla = $('tabla-novedades');
  const thead = tabla.querySelector('thead tr');
  const tbody = $('tabla-novedades-body');

  // Detectar si hay agentes duplicados (por código o por nombre) — solo relevante para admin
  const btnCombinar = $('btn-combinar-duplicados');
  if (btnCombinar) {
    const grupos = agruparAgentesPorIdentidad(novedadesActuales.agentes || []);
    const hayDuplicados = grupos.some(g => g.length > 1);
    btnCombinar.style.display = (esAdmin() && hayDuplicados) ? 'inline-flex' : 'none';
  }
  
  // Limpiar cabecera (mantener primeras 5 columnas)
  const colsFijas = 4;
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

    const desbloqueadoPorAdmin = (novedadesActuales.diasDesbloqueados || []).includes(dia);
    const bloqueado = dia !== diaHoy && !desbloqueadoPorAdmin;

    if (!bloqueado || esAdmin()) {
      th.style.cursor = 'pointer';
      th.title = `Clic para marcar "Sin Novedad" (S/N) en todos los agentes — día ${dia}`;
      th.addEventListener('click', () => seleccionarDiaColumna(dia));
    } else {
      th.style.cursor = 'not-allowed';
      th.title = 'Día bloqueado — clic para solicitar desbloqueo al administrador';
      th.addEventListener('click', () => solicitarDesbloqueo(dia));
    }

    thead.appendChild(th);
  }
  
  // Agregar columna observación
  const thObs = document.createElement('th');
  thObs.style.minWidth = '120px';
  thObs.textContent = 'Observación';
  thead.appendChild(thObs);

  // Agregar columna acción
  const thAccion = document.createElement('th');
  thAccion.style.width = '90px';
  thAccion.textContent = 'Acción';
  thead.appendChild(thAccion);
  
  // Limpiar cuerpo
  tbody.innerHTML = '';
  
  // Renderizar filas de agentes — ordenadas por código, de menor a mayor
  if (novedadesActuales.agentes && novedadesActuales.agentes.length > 0) {
    const agentesOrdenados = novedadesActuales.agentes
      .map((agente, origIdx) => ({ agente, origIdx }))
      .sort((a, b) => compararPorCodigo(a.agente.codigo, b.agente.codigo));

    agentesOrdenados.forEach(({ agente, origIdx }, posicion) => {
      const idx = origIdx; // idx real dentro de novedadesActuales.agentes (para editar/guardar)
      const tr = document.createElement('tr');
      tr.dataset.codigo = String(agente.codigo || '').toLowerCase();
      
      // Columnas fijas
      const tdNum = document.createElement('td');
      tdNum.textContent = posicion + 1;
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
      
      
      // Celdas de días
      for (let dia = 1; dia <= 31; dia++) {
        const td = document.createElement('td');
        td.style.textAlign = 'center';
        td.style.padding = '6px 3px';
        td.style.cursor = 'pointer';
        
        const valor = agente.novedadesPorDia && agente.novedadesPorDia[String(dia)] ? agente.novedadesPorDia[String(dia)] : '';
        td.textContent = valor || '—';
        
        // Bloquear días pasados
        const desbloqueadoPorAdmin = (novedadesActuales.diasDesbloqueados || []).includes(dia);
        const bloqueado = dia !== new Date().getDate() && !desbloqueadoPorAdmin;
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
        } else {
          // Día bloqueado: permitir al usuario solicitar desbloqueo
          td.title = 'Día bloqueado — clic para solicitar desbloqueo al administrador';
          td.addEventListener('click', () => solicitarDesbloqueo(dia));
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

      // Columna acción
      const tdAccion = document.createElement('td');
      tdAccion.style.position = 'relative';
      tdAccion.style.textAlign = 'center';
      const btnAccion = document.createElement('button');
      btnAccion.className = 'btn-acc btn-acc-blue';
      btnAccion.style.fontSize = '10px';
      btnAccion.style.padding = '4px 8px';
      btnAccion.textContent = 'Acción ▾';
      btnAccion.type = 'button';
      btnAccion.addEventListener('click', (e) => {
        e.stopPropagation();
        abrirMenuAccionRapida(idx, btnAccion);
      });
      tdAccion.appendChild(btnAccion);
      tr.appendChild(tdAccion);
      
      tbody.appendChild(tr);
    });
  } else {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 40;
    td.textContent = '⚠️ No hay agentes configurados para su área';
    td.style.textAlign = 'center';
    td.style.padding = '20px';
    td.style.color = 'var(--txt3)';
    tr.appendChild(td);
    tbody.appendChild(tr);
  }

  filtrarTablaPorCodigo();
}

function filtrarTablaPorCodigo() {
  const input = $('buscar-codigo-agente');
  if (!input) return;
  const texto = input.value.trim().toLowerCase();
  const tbody = $('tabla-novedades-body');
  if (!tbody) return;

  let visibles = 0;
  tbody.querySelectorAll('tr').forEach(tr => {
    if (tr.dataset.codigo === undefined) return; // fila de "sin agentes", no filtrar
    const coincide = !texto || tr.dataset.codigo.includes(texto);
    tr.style.display = coincide ? '' : 'none';
    if (coincide) visibles++;
  });

  let avisoVacio = $('aviso-busqueda-sin-resultados');
  if (texto && visibles === 0) {
    if (!avisoVacio) {
      avisoVacio = document.createElement('div');
      avisoVacio.id = 'aviso-busqueda-sin-resultados';
      avisoVacio.style.cssText = 'text-align:center;padding:16px;color:var(--txt3);font-size:13px;';
      tbody.parentElement.appendChild(avisoVacio);
    }
    avisoVacio.textContent = `Sin resultados para el código "${input.value.trim()}"`;
    avisoVacio.style.display = '';
  } else if (avisoVacio) {
    avisoVacio.style.display = 'none';
  }
}

let solicitudDesbloqueoDiasActual = null; // array de días a solicitar

async function solicitarDesbloqueo(dia) {
  try {
    // Evitar duplicar una solicitud pendiente para el mismo día/área/usuario
    const solRef = window._fb.collection(db, 'solicitudes');
    const q = window._fb.query(
      solRef,
      window._fb.where('correoUsuario', '==', usuario.email),
      window._fb.where('area', '==', areaActual),
      window._fb.where('mes', '==', mesActual),
      window._fb.where('dia', '==', dia),
      window._fb.where('estado', '==', 'pendiente')
    );
    const existentes = await window._fb.getDocs(q);
    if (!existentes.empty) {
      toast('Ya tiene una solicitud pendiente para ese día. Espere la respuesta del administrador.', 'ok');
      return;
    }

    solicitudDesbloqueoDiasActual = [dia];
    $('solicitud-desbloqueo-sub').textContent = `Día ${dia} — ${areaActual}`;
    $('solicitud-desbloqueo-razon').value = '';
    $('modal-solicitar-desbloqueo').style.display = 'flex';
    $('solicitud-desbloqueo-razon').focus();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function solicitarDesbloqueoTodos() {
  const dias = (diasPendientesActuales || []).slice().sort((a, b) => a - b);
  if (!dias.length) return;

  try {
    // Evitar duplicar una solicitud múltiple pendiente para la misma área/mes/usuario
    const solRef = window._fb.collection(db, 'solicitudes');
    const q = window._fb.query(
      solRef,
      window._fb.where('correoUsuario', '==', usuario.email),
      window._fb.where('area', '==', areaActual),
      window._fb.where('mes', '==', mesActual),
      window._fb.where('tipo', '==', 'desbloqueo_multiples_dias'),
      window._fb.where('estado', '==', 'pendiente')
    );
    const existentes = await window._fb.getDocs(q);
    if (!existentes.empty) {
      toast('Ya tiene una solicitud de desbloqueo pendiente para varios días. Espere la respuesta del administrador.', 'ok');
      return;
    }

    solicitudDesbloqueoDiasActual = dias;
    $('solicitud-desbloqueo-sub').textContent = `Días ${dias.join(', ')} — ${areaActual}`;
    $('solicitud-desbloqueo-razon').value = '';
    $('modal-solicitar-desbloqueo').style.display = 'flex';
    $('solicitud-desbloqueo-razon').focus();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

function cerrarModalSolicitudDesbloqueo() {
  $('modal-solicitar-desbloqueo').style.display = 'none';
  solicitudDesbloqueoDiasActual = null;
}

async function confirmarSolicitudDesbloqueo() {
  const razon = $('solicitud-desbloqueo-razon').value.trim();
  if (!razon) { toast('Contale al administrador el motivo', 'err'); return; }
  const dias = solicitudDesbloqueoDiasActual;
  if (!dias || !dias.length) return;

  try {
    const datosSolicitud = {
      area: areaActual,
      correoUsuario: usuario.email,
      mes: mesActual,
      razon: razon,
      estado: 'pendiente',
      fechaSolicitud: new Date(),
      fechaRespuesta: null,
      respuestaAdmin: null
    };

    if (dias.length === 1) {
      datosSolicitud.tipo = 'desbloqueo_dia';
      datosSolicitud.dia = dias[0];
    } else {
      datosSolicitud.tipo = 'desbloqueo_multiples_dias';
      datosSolicitud.dias = dias;
    }

    await window._fb.addDoc(window._fb.collection(db, 'solicitudes'), datosSolicitud);

    toast(
      dias.length === 1
        ? '✅ Solicitud enviada. El administrador la va a revisar.'
        : `✅ Solicitud enviada para ${dias.length} días. El administrador la va a revisar.`,
      'ok'
    );
    cerrarModalSolicitudDesbloqueo();
  } catch(e) {
    console.error(e);
    toast('❌ Error enviando solicitud: ' + e.message, 'err');
  }
}

function cerrarMenuAccionRapida() {
  const existente = document.getElementById('menu-accion-rapida');
  if (existente) existente.remove();
  document.removeEventListener('click', cerrarMenuAccionRapida);
}

function abrirMenuAccionRapida(idx, btnRef) {
  cerrarMenuAccionRapida();

  const dia = new Date().getDate();
  const menu = document.createElement('div');
  menu.id = 'menu-accion-rapida';
  menu.style.cssText = `
    position:absolute; z-index:2000; background:var(--white); border:1px solid var(--border);
    border-radius:8px; box-shadow:var(--shl); padding:6px; min-width:200px;
  `;

  const titulo = document.createElement('div');
  titulo.style.cssText = 'font-size:10px;font-weight:700;color:var(--txt2);padding:4px 8px;';
  titulo.textContent = `Marcar día ${dia} como:`;
  menu.appendChild(titulo);

  const itemObs = document.createElement('div');
  itemObs.style.cssText = 'padding:6px 8px;font-size:12px;cursor:pointer;border-radius:6px;font-weight:600;color:var(--blue-m);border-bottom:1px solid var(--border);margin-bottom:4px;';
  itemObs.textContent = '✏️ Editar observación...';
  itemObs.addEventListener('mouseover', () => itemObs.style.background = 'var(--blue-l)');
  itemObs.addEventListener('mouseout', () => itemObs.style.background = '');
  itemObs.addEventListener('click', (e) => {
    e.stopPropagation();
    cerrarMenuAccionRapida();
    const agente = novedadesActuales.agentes[idx];
    if (agente) abrirModalEditarNovedad(agente, dia, idx);
  });
  menu.appendChild(itemObs);

  CODIGOS_VALIDOS.forEach(c => {
    const item = document.createElement('div');
    item.style.cssText = 'padding:6px 8px;font-size:12px;cursor:pointer;border-radius:6px;';
    item.textContent = `${c} — ${CODIGOS_DESC[c]}`;
    item.addEventListener('mouseover', () => item.style.background = 'var(--blue-l)');
    item.addEventListener('mouseout', () => item.style.background = '');
    item.addEventListener('click', (e) => {
      e.stopPropagation();
      cerrarMenuAccionRapida();
      aplicarCodigoRapido(idx, dia, c);
    });
    menu.appendChild(item);
  });

  document.body.appendChild(menu);
  const rect = btnRef.getBoundingClientRect();
  menu.style.top = `${window.scrollY + rect.bottom + 4}px`;
  menu.style.left = `${window.scrollX + rect.right - menu.offsetWidth}px`;

  setTimeout(() => document.addEventListener('click', cerrarMenuAccionRapida), 0);
}

async function aplicarCodigoRapido(idx, dia, codigo) {
  if (!esAdmin() && dia !== new Date().getDate()) {
    toast('❌ Solo puede editar el día de hoy. Para días anteriores, solicite desbloqueo.', 'err');
    return;
  }
  const agente = novedadesActuales.agentes[idx];
  if (!agente) return;

  if (!agente.novedadesPorDia) agente.novedadesPorDia = {};
  agente.novedadesPorDia[String(dia)] = codigo;
  // Solo autocompletar con la descripción del código si aún no hay una observación personalizada
  if (!agente.observaciones) {
    agente.observaciones = CODIGOS_DESC[codigo] || '';
  }
  actualizarDiaCompletado(dia);

  try {
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: novedadesActuales.agentes,
      diasNoCompletados: novedadesActuales.diasNoCompletados,
      ultimaModificacion: new Date()
    });
    await registrarEnAuditoria('modificar_novedad', areaActual, usuario.email, dia, mesActual, { codigo }, `Acción rápida: ${agente.apellidosNombres} - Día ${dia} - ${codigo}`);
    renderizarTablaNovedades(new Date().getDate());
    verificarDiasPendientes();
    toast(`✅ Marcado como "${codigo}"`, 'ok');
  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function combinarDuplicadosArea() {
  const agentes = novedadesActuales.agentes || [];
  const grupos = agruparAgentesPorIdentidad(agentes);
  const duplicados = grupos.filter(g => g.length > 1);

  if (duplicados.length === 0) {
    toast('No se encontraron duplicados en esta área', 'ok');
    return;
  }

  const resumen = duplicados.map(g => {
    const nombre = (g.find(a => (a.apellidosNombres || '').trim()) || {}).apellidosNombres || '(sin nombre)';
    return `${nombre}: ${g.length} registros`;
  }).join('\n');
  const confirmar = await confirmarAccion(
    `Se van a combinar estos duplicados en un solo registro por agente, uniendo los días que cada uno tenga cargados:\n\n${resumen}\n\n¿Confirma?`,
    'Combinar duplicados'
  );
  if (!confirmar) return;

  try {
    const agentesFinal = grupos.map(grupo => {
      if (grupo.length === 1) return grupo[0];

      // Preferir como base el registro con código numérico válido
      // (cubre el caso de un registro con código/grado invertidos)
      const conCodigoValido = grupo.filter(a => /^\d+$/.test(String(a.codigo || '').trim()));
      const candidatos = conCodigoValido.length ? conCodigoValido : grupo;

      // Entre los candidatos, preferir el que tenga el grado más completo
      const base = candidatos.reduce((mejor, actual) => {
        const gradoActual = String(actual.grado || '').trim();
        const gradoMejor = String(mejor.grado || '').trim();
        if (gradoActual.length !== gradoMejor.length) {
          return gradoActual.length > gradoMejor.length ? actual : mejor;
        }
        return (actual.apellidosNombres || '').length > (mejor.apellidosNombres || '').length ? actual : mejor;
      });

      // Unir los días cargados de todas las copias (el valor no vacío gana)
      const novedadesPorDiaUnidas = {};
      grupo.forEach(g => {
        Object.entries(g.novedadesPorDia || {}).forEach(([dia, val]) => {
          if (val && !novedadesPorDiaUnidas[dia]) novedadesPorDiaUnidas[dia] = val;
        });
      });
      const observacionUnida = grupo.map(g => g.observaciones).find(o => o) || '';

      return {
        codigo: base.codigo,
        grado: base.grado,
        apellidosNombres: base.apellidosNombres,
        novedadesPorDia: novedadesPorDiaUnidas,
        observaciones: observacionUnida
      };
    });

    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: agentesFinal,
      ultimaModificacion: new Date()
    });

    await registrarEnAuditoria(
      'combinar_duplicados', areaActual, usuario.email, null, mesActual,
      { antes: agentes.length, despues: agentesFinal.length },
      `Duplicados combinados en ${areaActual}: ${agentes.length} → ${agentesFinal.length} agentes`
    );

    toast(`✅ Combinado: ${agentes.length} registros → ${agentesFinal.length} agentes`, 'ok');
    cargarNovedadesActuales();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

let diasPendientesActuales = [];

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
  
  diasPendientesActuales = diasSinCompletar;
  const btnTodos = $('btn-solicitar-desbloqueo-todos');

  if (diasSinCompletar.length > 0) {
    show('info-dias-pendientes');
    $('info-pendientes-txt').textContent = `⚠️ Días sin completar: ${diasSinCompletar.join(', ')}`;
    if (btnTodos) {
      btnTodos.style.display = '';
      const txtBtn = $('txt-btn-solicitar-desbloqueo-todos');
      if (txtBtn) txtBtn.textContent = `Solicitar desbloqueo (${diasSinCompletar.length} días)`;
    }
  } else {
    hide('info-dias-pendientes');
    if (btnTodos) btnTodos.style.display = 'none';
  }
}

/* ═════════════════════════════════════════
   MODAL: Editar Novedad
═════════════════════════════════════════ */

let _resolveConfirmacion = null;
let _confirmacionTextoEsperado = null;

function confirmarAccion(mensaje, titulo = 'Confirmar') {
  return new Promise((resolve) => {
    _resolveConfirmacion = resolve;
    _confirmacionTextoEsperado = null;
    hide('confirmacion-generica-input-wrap');
    $('confirmacion-generica-titulo').textContent = titulo;
    $('confirmacion-generica-mensaje').textContent = mensaje;
    $('modal-confirmacion-generica').style.display = 'flex';
  });
}

function confirmarConTexto(mensaje, textoEsperado, titulo = 'Confirmar') {
  return new Promise((resolve) => {
    _resolveConfirmacion = resolve;
    _confirmacionTextoEsperado = textoEsperado;
    $('confirmacion-generica-input').value = '';
    show('confirmacion-generica-input-wrap');
    $('confirmacion-generica-input-wrap').style.display = 'flex';
    $('confirmacion-generica-titulo').textContent = titulo;
    $('confirmacion-generica-mensaje').textContent = mensaje;
    $('modal-confirmacion-generica').style.display = 'flex';
    setTimeout(() => $('confirmacion-generica-input')?.focus(), 50);
  });
}

function intentarConfirmarGenerico() {
  if (_confirmacionTextoEsperado !== null) {
    const val = $('confirmacion-generica-input').value.trim();
    if (val !== _confirmacionTextoEsperado) {
      toast(`Debe escribir exactamente: ${_confirmacionTextoEsperado}`, 'err');
      return;
    }
  }
  responderConfirmacion(true);
}

function responderConfirmacion(valor) {
  $('modal-confirmacion-generica').style.display = 'none';
  _confirmacionTextoEsperado = null;
  if (_resolveConfirmacion) { _resolveConfirmacion(valor); _resolveConfirmacion = null; }
}

let modalAgenteEdicion = null;
let modalDiaEdicion = null;
let modalIdxEdicion = null;
let modalEsEdicionDeCierre = false;
let resumenGeneralCache = null;

function poblarSelectCodigos(select) {
  if (select.dataset.poblado === '1') return;
  CODIGOS_VALIDOS.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c;
    opt.textContent = `${c} — ${CODIGOS_DESC[c]}`;
    select.appendChild(opt);
  });
  select.dataset.poblado = '1';
}

function actualizarObsSegunCodigo() {
  const codigo = $('modal-novedad-codigo').value;
  $('modal-novedad-obs').value = codigo ? (CODIGOS_DESC[codigo] || '') : '';
}

function abrirModalEditarNovedad(agente, dia, idx) {
  modalAgenteEdicion = agente;
  modalDiaEdicion = dia;
  modalIdxEdicion = idx;
  modalEsEdicionDeCierre = false;
  
  const modal = $('modal-editar-novedad');
  const sub = $('modal-novedad-sub');
  const codigo = $('modal-novedad-codigo');
  const obs = $('modal-novedad-obs');
  
  poblarSelectCodigos(codigo);
  
  sub.textContent = `Día ${dia} — ${agente.apellidosNombres}`;
  codigo.value = (agente.novedadesPorDia && agente.novedadesPorDia[String(dia)]) || '';
  obs.value = agente.observaciones || (codigo.value ? (CODIGOS_DESC[codigo.value] || '') : '');
  
  hide('modal-novedad-error');
  
  modal.style.display = 'flex';
  codigo.focus();
}

function cerrarModalNovedad() {
  $('modal-editar-novedad').style.display = 'none';
  hide('modal-novedad-error');
  modalAgenteEdicion = null;
  modalDiaEdicion = null;
  modalIdxEdicion = null;
}

function actualizarDiaCompletado(dia) {
  const todosCompletos = (novedadesActuales.agentes || []).length > 0 &&
    novedadesActuales.agentes.every(a => a.novedadesPorDia && a.novedadesPorDia[String(dia)]);
  if (!novedadesActuales.diasNoCompletados) novedadesActuales.diasNoCompletados = [];
  if (todosCompletos) {
    novedadesActuales.diasNoCompletados = novedadesActuales.diasNoCompletados.filter(d => d !== dia);
  } else if (!novedadesActuales.diasNoCompletados.includes(dia)) {
    novedadesActuales.diasNoCompletados.push(dia);
  }
}

async function guardarNovedad() {
  if (!modalAgenteEdicion) return;
  
  const codigo = $('modal-novedad-codigo').value.trim();
  
  if (!codigo) {
    mostrarErrorCodigo('Elegí una nomenclatura de la lista');
    return;
  }
  
  // Normalizar y validar
  const codigoNorm = normalizarCodigo(codigo);
  
  if (!validarCodigo(codigoNorm)) {
    mostrarErrorCodigo(`"${codigo}" no es un código válido`);
    return;
  }
  
  const obs = $('modal-novedad-obs').value.trim() || CODIGOS_DESC[codigoNorm] || '';
  
  // Actualizar en memoria
  if (!modalAgenteEdicion.novedadesPorDia) {
    modalAgenteEdicion.novedadesPorDia = {};
  }
  modalAgenteEdicion.novedadesPorDia[String(modalDiaEdicion)] = codigoNorm;
  modalAgenteEdicion.observaciones = obs;

  // Guardar en Firestore
  try {
    if (modalEsEdicionDeCierre && cierreMesData) {
      // Edición de un día desbloqueado dentro de un mes YA CERRADO:
      // se guarda en el documento de ese período (no en el actual),
      // y el día se vuelve a bloquear automáticamente al guardar.
      const { area, periodo, data } = cierreMesData;
      const diasDesbloqueados = (data.diasDesbloqueados || []).filter(d => d !== modalDiaEdicion);

      const novedadesRef = window._fb.doc(db, 'novedades', area, periodo, 'datos');
      await window._fb.updateDoc(novedadesRef, {
        agentes: data.agentes,
        diasDesbloqueados,
        ultimaModificacion: new Date()
      });
      data.diasDesbloqueados = diasDesbloqueados;

      await registrarEnAuditoria(
        'modificar_novedad_mes_cerrado', area, usuario.email, modalDiaEdicion, periodo,
        { codigo: codigoNorm, observaciones: obs },
        `Corrección en mes cerrado: ${modalAgenteEdicion.apellidosNombres} - Día ${modalDiaEdicion} - ${codigoNorm} (se vuelve a bloquear)`
      );

      toast('✅ Corrección guardada — el día se volvió a bloquear', 'ok');
      cerrarModalNovedad();
      modalEsEdicionDeCierre = false;
      renderizarTablaSoloLectura($('tabla-cierre-mes'), data, periodo);
      return;
    }

    actualizarDiaCompletado(modalDiaEdicion);
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: novedadesActuales.agentes,
      diasNoCompletados: novedadesActuales.diasNoCompletados,
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

async function llenarSinNovedadDia(dia) {
  try {
    // Llenar todos los agentes con S/N para el día indicado
    if (novedadesActuales.agentes) {
      novedadesActuales.agentes.forEach(agente => {
        if (!agente.novedadesPorDia) agente.novedadesPorDia = {};
        agente.novedadesPorDia[String(dia)] = 'S/N';
        agente.observaciones = CODIGOS_DESC['S/N'];
      });
    }
    actualizarDiaCompletado(dia);

    // Guardar en Firestore
    const novedadesRef = window._fb.doc(db, 'novedades', areaActual, mesActual, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      agentes: novedadesActuales.agentes,
      diasNoCompletados: novedadesActuales.diasNoCompletados,
      ultimaModificacion: new Date()
    });

    // Log
    await registrarEnAuditoria(
      'rellenar_sin_novedad',
      areaActual,
      usuario.email,
      dia,
      mesActual,
      { cantidadAgentes: novedadesActuales.agentes.length },
      `Auto-relleno S/N: ${novedadesActuales.agentes.length} agentes - Día ${dia}`
    );

    renderizarTablaNovedades(new Date().getDate());
    toast(`✅ Se llenó "Sin Novedad" para todos los agentes del día ${dia}`, 'ok');

  } catch(e) {
    console.error('Error:', e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function llenarSinNovedadHoy() {
  const hoy = new Date().getDate();
  await llenarSinNovedadDia(hoy);
}

async function seleccionarDiaColumna(dia) {
  const desbloqueadoPorAdmin = (novedadesActuales.diasDesbloqueados || []).includes(dia);
  const bloqueado = dia !== new Date().getDate() && !desbloqueadoPorAdmin;
  if (bloqueado && !esAdmin()) {
    toast('❌ Ese día está bloqueado. Solicite desbloqueo al administrador si necesita corregirlo.', 'err');
    return;
  }

  const mensaje = bloqueado
    ? `⚠️ Este día está bloqueado para los usuarios — solo usted, como administrador, puede sobrescribirlo.\n\n¿Marcar "Sin Novedad" (S/N) para todos los agentes en el día ${dia}? Esto sobrescribe lo que ya esté cargado ese día.`
    : `¿Marcar "Sin Novedad" (S/N) para todos los agentes en el día ${dia}? Esto sobrescribe lo que ya esté cargado ese día.`;

  const confirmar = await confirmarAccion(mensaje, `Día ${dia}${bloqueado ? ' — BLOQUEADO' : ''}`);
  if (!confirmar) return;
  await llenarSinNovedadDia(dia);
}

function diasEnMes(periodo) {
  const [anio, mes] = periodo.split('-').map(Number);
  return new Date(anio, mes, 0).getDate();
}

/* ═════════════════════════════════════════
   CIERRE DE MES — pantalla de solo lectura
═════════════════════════════════════════ */

let cierreMesData = null; // { area, periodo, data }

function mostrarCierreMes(area, periodo, data) {
  cierreMesData = { area, periodo, data };

  hide('tabla-novedades-container');
  hide('novedades-top-controles');
  hide('tabla-cargando');
  show('cierre-mes-container');
  $('cierre-mes-container').style.display = 'block';

  $('cierre-mes-nombre').textContent = `${obtenerNombreMes(periodo.split('-')[1])} ${periodo.split('-')[0]} — ${area}`;

  renderizarTablaSoloLectura($('tabla-cierre-mes'), data, periodo);

  hide('cierre-mes-aviso-usuario');
  show('cierre-mes-form-admin');
  $('cierre-mes-form-admin').style.display = 'block';
  $('cierre-elaborado-por').value = data.elaboradoPor || '';
  $('cierre-responsable').value = data.responsable || '';
  cargarListaPersonalParaCierre();
}

let personalListaCache = null; // caché en memoria de sistema/personal_lis
let selectorPersonaTargetId = null; // en qué input escribir la persona elegida

async function cargarListaPersonalParaCierre() {
  await obtenerListaPersonal(); // solo precarga el caché
}

async function obtenerListaPersonal() {
  if (personalListaCache) return personalListaCache;
  try {
    const ref = window._fb.doc(db, 'sistema', 'personal_lis');
    const snap = await window._fb.getDoc(ref);
    personalListaCache = (snap.exists() && snap.data().lista) ? snap.data().lista : [];
  } catch(e) {
    console.warn('No se pudo cargar la lista de personal:', e);
    personalListaCache = [];
  }
  return personalListaCache;
}

async function abrirSelectorPersona(targetInputId) {
  selectorPersonaTargetId = targetInputId;
  await obtenerListaPersonal();
  $('buscador-persona').value = '';
  renderizarListaPersonal(personalListaCache.slice(0, 50));
  $('modal-seleccionar-persona').style.display = 'flex';
  $('buscador-persona').focus();
}

function cerrarSelectorPersona() {
  $('modal-seleccionar-persona').style.display = 'none';
  selectorPersonaTargetId = null;
}

function filtrarListaPersonal() {
  const q = $('buscador-persona').value.toLowerCase().trim();
  const lista = personalListaCache || [];
  const filtrados = q
    ? lista.filter(nombre => nombre.toLowerCase().includes(q)).slice(0, 50)
    : lista.slice(0, 50);
  renderizarListaPersonal(filtrados);
}

function renderizarListaPersonal(lista) {
  const cont = $('lista-persona-resultados');
  if (lista.length === 0) {
    cont.innerHTML = `<div style="padding:16px;text-align:center;color:var(--txt2);font-size:12px;">Sin resultados</div>`;
    return;
  }
  cont.innerHTML = lista.map(nombre => `
    <div style="padding:10px 12px;font-size:12px;cursor:pointer;border-bottom:1px solid var(--border);" 
         onmouseover="this.style.background='var(--blue-l)'" onmouseout="this.style.background=''"
         onclick="elegirPersona('${nombre.replace(/'/g, "\\'")}')">
      ${nombre}
    </div>
  `).join('');
}

function elegirPersona(nombre) {
  if (selectorPersonaTargetId) $(selectorPersonaTargetId).value = nombre;
  cerrarSelectorPersona();
}

function poblarSelectoresReportePrueba() {
  const selMes = $('reporte-prueba-mes');
  const selAnio = $('reporte-prueba-anio');
  if (!selMes || !selAnio) return;

  if (selMes.options.length === 0) {
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = m;
      selMes.appendChild(opt);
    });
    const hoy = obtenerFechaParts();
    selMes.value = hoy.mes;
  }
  if (selAnio.options.length === 0) {
    const anioActual = new Date().getFullYear();
    for (let a = anioActual - 1; a <= anioActual + 1; a++) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      selAnio.appendChild(opt);
    }
    selAnio.value = String(anioActual);
  }
}

async function generarReportePrueba() {
  const mes = $('reporte-prueba-mes').value;
  const anio = $('reporte-prueba-anio').value;
  const elaboradoPor = $('reporte-prueba-elaborado-por').value.trim();
  const responsable = $('reporte-prueba-responsable').value.trim();

  if (!mes || !anio) { toast('Elegí mes y año', 'err'); return; }
  if (!elaboradoPor || !responsable) { toast('Elegí "Elaborado por" y "Responsable"', 'err'); return; }
  if (!areaActual) { toast('Elegí un área arriba primero', 'err'); return; }

  const periodo = `${anio}-${mes}`;

  try {
    toast('⏳ Generando reporte de prueba...', 'ok');
    const ref = window._fb.doc(db, 'novedades', areaActual, periodo, 'datos');
    const snap = await window._fb.getDoc(ref);

    if (!snap.exists() || (snap.data().agentes || []).length === 0) {
      toast(`No hay datos de Novedades para ${areaActual} — ${periodo}`, 'err');
      return;
    }

    const data = snap.data();
    await exportarNovedadesExcel(data, areaActual, periodo, elaboradoPor, responsable);
    await exportarNovedadesPDF(data, areaActual, periodo, elaboradoPor, responsable);

    toast('✅ Reporte de prueba generado (no se modificó el estado del mes)', 'ok');
  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

function aplicarVisibilidadTabsAdmin() {
  const tabsMap = { envios: '📤 Envíos', importar: '📥 Importar BD', accesos: '🔐 Accesos', auditoria: '📋 Auditoría', desbloqueos: '🔓 Desbloqueos', resumen: '📊 Resumen General' };
  let primeraVisible = null;

  document.querySelectorAll('.admin-tab').forEach(tab => {
    const tabName = tab.dataset.tab;
    if (tabName === 'permisos') {
      tab.style.display = esAdmin() ? 'inline-flex' : 'none';
      return;
    }
    const permitido = tabPermitido(tabName);
    tab.style.display = permitido ? 'inline-flex' : 'none';
    if (permitido && !primeraVisible) primeraVisible = tabName;
  });

  // Si el usuario no tiene la pestaña "Envíos" (activa por defecto) permitida,
  // activar automáticamente la primera pestaña que sí tenga.
  const tabEnviosPermitido = tabPermitido('envios');
  if (!tabEnviosPermitido && primeraVisible) {
    const tabBtn = document.querySelector(`.admin-tab[data-tab="${primeraVisible}"]`);
    if (tabBtn) tabBtn.click();
  } else if (tabEnviosPermitido) {
    cargarAdmin();
  }
  aplicarPermisosBotones();
}

function ocultarPantallaCierreMes() {
  hide('cierre-mes-container');
  cierreMesData = null;
}

function renderizarTablaSoloLectura(tabla, data, periodo) {
  const totalDias = diasEnMes(periodo);
  const diasDesbloqueados = data.diasDesbloqueados || [];
  let html = '<thead><tr><th>Código</th><th>Grado</th><th>Apellidos y Nombres</th>';
  for (let d = 1; d <= 31; d++) {
    const desbloqueado = diasDesbloqueados.includes(d);
    html += `<th style="width:32px;${d > totalDias ? 'opacity:.25' : ''}${desbloqueado ? ';color:var(--green);' : ''}">${d}${desbloqueado ? ' 🔓' : ''}</th>`;
  }
  html += '<th>Observación</th></tr></thead><tbody>';

  (data.agentes || [])
    .map((agente, origIdx) => ({ agente, origIdx }))
    .sort((a, b) => compararPorCodigo(a.agente.codigo, b.agente.codigo))
    .forEach(({ agente, origIdx }) => {
    const idx = origIdx; // índice real en data.agentes (para editar el agente correcto)
    html += `<tr><td style="font-size:11px">${agente.codigo || ''}</td><td style="font-size:11px">${agente.grado || ''}</td><td style="font-size:11px;text-align:left">${agente.apellidosNombres || ''}</td>`;
    for (let d = 1; d <= 31; d++) {
      const valor = (agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || '';
      const desbloqueado = diasDesbloqueados.includes(d);
      if (d > totalDias) {
        html += `<td style="font-size:11px;opacity:.25"></td>`;
      } else if (desbloqueado) {
        html += `<td style="font-size:11px;cursor:pointer;background:var(--green-l);border:2px solid var(--green);" onclick="abrirModalEditarNovedadCierre(${idx},${d})" title="Día desbloqueado por el admin — clic para editar">${valor || '— (clic para editar)'}</td>`;
      } else {
        html += `<td style="font-size:11px;">${valor || '—'}</td>`;
      }
    }
    html += `<td style="font-size:11px">${agente.observaciones || ''}</td></tr>`;
  });
  html += '</tbody>';
  tabla.innerHTML = html;
}

async function abrirModalEditarNovedadCierre(idx, dia) {
  if (!cierreMesData) return;
  const agente = cierreMesData.data.agentes[idx];
  if (!agente) return;

  // Reutiliza el mismo modal de edición, pero guardando en el período del cierre (no en mesActual)
  modalAgenteEdicion = agente;
  modalDiaEdicion = dia;
  modalIdxEdicion = idx;
  modalEsEdicionDeCierre = true; // bandera para que guardarNovedad sepa a qué doc escribir

  const modal = $('modal-editar-novedad');
  const sub = $('modal-novedad-sub');
  const codigo = $('modal-novedad-codigo');
  const obs = $('modal-novedad-obs');

  poblarSelectCodigos(codigo);

  sub.textContent = `Día ${dia} (desbloqueado) — ${agente.apellidosNombres}`;
  codigo.value = (agente.novedadesPorDia && agente.novedadesPorDia[String(dia)]) || '';
  obs.value = agente.observaciones || (codigo.value ? (CODIGOS_DESC[codigo.value] || '') : '');

  hide('modal-novedad-error');
  modal.style.display = 'flex';
  codigo.focus();
}

async function cerrarYExportarMes() {
  if (!cierreMesData) return;
  const elaboradoPor = $('cierre-elaborado-por').value.trim();
  const responsable = $('cierre-responsable').value.trim();

  if (!elaboradoPor || !responsable) {
    toast('❌ Complete "Elaborado por" y "Responsable" antes de cerrar el mes', 'err');
    return;
  }

  try {
    toast('⏳ Generando reporte...', 'ok');
    const { area, periodo, data } = cierreMesData;

    const novedadesRef = window._fb.doc(db, 'novedades', area, periodo, 'datos');
    await window._fb.updateDoc(novedadesRef, {
      estado: 'cerrado',
      elaboradoPor,
      responsable,
      fechaCierre: new Date()
    });

    await registrarEnAuditoria('cerrar_mes', area, usuario.email, null, periodo, { elaboradoPor, responsable }, `Mes ${periodo} cerrado por ${usuario.email}`);

    data.elaboradoPor = elaboradoPor;
    data.responsable = responsable;

    await exportarNovedadesExcel(data, area, periodo, elaboradoPor, responsable);
    await exportarNovedadesPDF(data, area, periodo, elaboradoPor, responsable);

    toast('✅ Mes cerrado y reporte exportado', 'ok');
    ocultarPantallaCierreMes();
    cargarNovedadesActuales();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   EXPORTAR — Excel (formato oficial)
═════════════════════════════════════════ */

async function exportarNovedadesExcel(data, area, periodo, elaboradoPor, responsable) {
  if (!window.ExcelJS) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const totalDias = diasEnMes(periodo);
  const [anio, mesNum] = periodo.split('-');
  const nombreMes = obtenerNombreMes(mesNum);
  const numCols = 1 + 3 + 31 + 1; // N°, código, grado, nombres + 31 días + observación

  // Colores de la plantilla oficial
  const NAVY = 'FF1F3864';
  const AMARILLO = 'FFFFFF00';
  const VERDE_CLARO = 'FFD9EAD3';
  const BLANCO = 'FFFFFFFF';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Novedades');

  ws.columns = [
    { width: 5 }, { width: 8 }, { width: 12 }, { width: 30 },
    ...Array.from({ length: 31 }, () => ({ width: 4 })),
    { width: 22 }
  ];

  const estiloNavy = (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.font = { color: { argb: BLANCO }, bold: true };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  };
  const estiloAmarillo = (cell) => {
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AMARILLO } };
    cell.alignment = { horizontal: 'center' };
  };

  // ── Título ──
  ws.mergeCells(1, 1, 1, numCols);
  const tituloCell = ws.getCell(1, 1);
  tituloCell.value = 'COMISIÓN DE TRÁNSITO DEL ECUADOR — CONTROL DE NOVEDADES MENSUAL';
  estiloNavy(tituloCell);
  ws.getRow(1).height = 22;

  // ── Área ──
  const totalEfectivo = (data.agentes || []).length;
  ws.mergeCells(2, 1, 2, numCols);
  const areaCell = ws.getCell(2, 1);
  areaCell.value = `ÁREA: ${area}   ·   MES: ${nombreMes.toUpperCase()} ${anio}   ·   EFECTIVO: ${totalEfectivo}`;
  estiloNavy(areaCell);

  ws.addRow([]);

  // ── Encabezado de columnas ──
  const headerRow = ['N°', 'CÓDIGO', 'GRADO', 'APELLIDOS Y NOMBRES'];
  for (let d = 1; d <= 31; d++) headerRow.push(d);
  headerRow.push('OBSERVACIÓN');
  const filaHeader = ws.addRow(headerRow);
  filaHeader.eachCell(c => estiloNavy(c));

  // ── Repetir el banner (título + área/mes) y encabezado de columnas en cada página impresa ──
  ws.pageSetup.printTitlesRow = '1:4';
  ws.pageSetup.orientation = 'landscape';
  ws.pageSetup.fitToPage = true;
  ws.pageSetup.fitToWidth = 1;
  ws.pageSetup.fitToHeight = 0;

  // ── Contador de hojas al pie de cada página impresa ──
  ws.headerFooter.oddFooter = '&CPágina &P de &N';
  ws.headerFooter.evenFooter = '&CPágina &P de &N';

  // ── Filas de agentes — días en amarillo (zona de datos, como la plantilla) ──
  ordenarAgentesPorCodigo(data.agentes).forEach((agente, idx) => {
    const fila = [idx + 1, agente.codigo || '', agente.grado || '', agente.apellidosNombres || ''];
    for (let d = 1; d <= 31; d++) {
      fila.push(d > totalDias ? '' : ((agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || ''));
    }
    fila.push(agente.observaciones || '');
    const row = ws.addRow(fila);

    row.getCell(1).alignment = { horizontal: 'center' };
    row.getCell(2).alignment = { horizontal: 'center' };
    row.getCell(3).alignment = { horizontal: 'left' };
    row.getCell(4).alignment = { horizontal: 'left' };
    for (let d = 1; d <= 31; d++) {
      const cell = row.getCell(4 + d);
      if (d > totalDias) {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFD9D9D9' } };
      } else {
        estiloAmarillo(cell);
      }
    }
    row.getCell(numCols).alignment = { horizontal: 'left' };
  });

  ws.addRow([]);

  // ── Nomenclatura ──
  ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, numCols);
  const filaNomTitulo = ws.getRow(ws.rowCount);
  filaNomTitulo.getCell(1).value = 'NOMENCLATURA';
  filaNomTitulo.eachCell({ includeEmpty: true }, c => estiloNavy(c));

  CODIGOS_VALIDOS.forEach(c => {
    const row = ws.addRow([c, CODIGOS_DESC[c]]);
    row.eachCell({ includeEmpty: false }, cell => {
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: VERDE_CLARO } };
    });
    row.getCell(1).font = { bold: true };
  });

  ws.addRow([]);
  const filaNota = ws.addRow(['NOTA: Para meses de 28, 29 o 30 días, se dejan en blanco las columnas de los días que no existen en ese mes.']);
  ws.mergeCells(filaNota.number, 1, filaNota.number, numCols);

  ws.addRow([]);

  // ── Certificación ──
  const filaCertTituloNum = ws.rowCount + 1;
  ws.mergeCells(filaCertTituloNum, 1, filaCertTituloNum, numCols);
  const filaCertTitulo = ws.getRow(filaCertTituloNum);
  filaCertTitulo.getCell(1).value = 'CERTIFICACIÓN';
  filaCertTitulo.eachCell({ includeEmpty: true }, c => estiloNavy(c));

  const mitad = Math.floor(numCols / 2);
  const filaLabelsNum = filaCertTituloNum + 1;
  ws.mergeCells(filaLabelsNum, 1, filaLabelsNum, mitad);
  ws.mergeCells(filaLabelsNum, mitad + 1, filaLabelsNum, numCols);
  const filaCertLabels = ws.getRow(filaLabelsNum);
  filaCertLabels.getCell(1).value = 'ELABORADO POR';
  filaCertLabels.getCell(mitad + 1).value = 'RESPONSABLE';
  filaCertLabels.eachCell({ includeEmpty: true }, c => estiloNavy(c));

  const filaValoresNum = filaLabelsNum + 1;
  ws.mergeCells(filaValoresNum, 1, filaValoresNum, mitad);
  ws.mergeCells(filaValoresNum, mitad + 1, filaValoresNum, numCols);
  const filaCertValores = ws.getRow(filaValoresNum);
  filaCertValores.getCell(1).value = elaboradoPor;
  filaCertValores.getCell(mitad + 1).value = responsable;
  filaCertValores.eachCell({ includeEmpty: true }, c => estiloAmarillo(c));
  filaCertValores.height = 22;

  // ── Recuadro de firma (en blanco) ──
  const filaFirmaNum = filaValoresNum + 1;
  ws.mergeCells(filaFirmaNum, 1, filaFirmaNum, mitad);
  ws.mergeCells(filaFirmaNum, mitad + 1, filaFirmaNum, numCols);
  const filaFirma = ws.getRow(filaFirmaNum);
  filaFirma.eachCell({ includeEmpty: true }, c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: BLANCO } };
  });
  filaFirma.height = 45;

  // ── Líneas de cuadrícula en toda la hoja ──
  const bordeDelgado = { style: 'thin', color: { argb: 'FF999999' } };
  ws.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: true }, cell => {
      cell.border = { top: bordeDelgado, left: bordeDelgado, bottom: bordeDelgado, right: bordeDelgado };
    });
  });

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `novedades_${area}_${periodo}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

/* ═════════════════════════════════════════
   EXPORTAR — PDF (formato oficial)
═════════════════════════════════════════ */

async function exportarNovedadesPDF(data, area, periodo, elaboradoPor, responsable) {
  if (!window.jspdf) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }
  if (!window.jspdf.jsPDF.API.autoTable) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.2/jspdf.plugin.autotable.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { jsPDF } = window.jspdf;
  const totalDias = diasEnMes(periodo);
  const [anio, mesNum] = periodo.split('-');
  const nombreMes = obtenerNombreMes(mesNum);

  // Colores de la plantilla oficial
  const NAVY = [31, 56, 100];
  const AMARILLO = [255, 255, 0];
  const VERDE_CLARO = [217, 234, 211];
  const BLANCO = [255, 255, 255];

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });
  const anchoPagina = doc.internal.pageSize.getWidth();
  const totalEfectivo = (data.agentes || []).length;

  // ── Banners de título (se redibujan en cada página vía didDrawPage) ──
  const dibujarBanner = () => {
    doc.setFillColor(...NAVY);
    doc.rect(10, 8, anchoPagina - 20, 8, 'F');
    doc.setTextColor(...BLANCO);
    doc.setFontSize(12);
    doc.setFont(undefined, 'bold');
    doc.text('COMISIÓN DE TRÁNSITO DEL ECUADOR — CONTROL DE NOVEDADES MENSUAL', anchoPagina / 2, 13.5, { align: 'center' });

    doc.setFillColor(...NAVY);
    doc.rect(10, 16, anchoPagina - 20, 7, 'F');
    doc.setFontSize(10);
    doc.text(`ÁREA: ${area}   ·   MES: ${nombreMes.toUpperCase()} ${anio}   ·   EFECTIVO: ${totalEfectivo}`, anchoPagina / 2, 21, { align: 'center' });
    doc.setTextColor(0, 0, 0);
  };
  dibujarBanner();

  const head = [['N°', 'Código', 'Grado', 'Apellidos y Nombres', ...Array.from({length: totalDias}, (_, i) => String(i + 1)), 'Observación']];
  const body = ordenarAgentesPorCodigo(data.agentes).map((agente, idx) => {
    const fila = [idx + 1, agente.codigo || '', agente.grado || '', agente.apellidosNombres || ''];
    for (let d = 1; d <= totalDias; d++) {
      const valorDia = ((agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || '').trim();
      const sinNovedad = valorDia === '' || valorDia.toUpperCase() === 'S/N';
      fila.push(sinNovedad ? '' : valorDia);
    }
    fila.push(agente.observaciones || '');
    return fila;
  });

  // ── Anchos de columna fijos, calculados para que la tabla nunca exceda
  //    el ancho útil de la página (márgenes de 10mm a cada lado) ──
  const margenLateral = 10;
  const anchoUtil = anchoPagina - (margenLateral * 2);
  const anchoNo = 7;
  const anchoCodigo = 14;
  const anchoGrado = 16;
  const anchoNombres = 38;
  const anchoObservacion = 22;
  const anchoFijosTotal = anchoNo + anchoCodigo + anchoGrado + anchoNombres + anchoObservacion;
  const anchoDia = (anchoUtil - anchoFijosTotal) / totalDias;

  const columnStyles = {
    0: { cellWidth: anchoNo, halign: 'center' },
    1: { cellWidth: anchoCodigo, halign: 'center' },
    2: { cellWidth: anchoGrado, halign: 'center' },
    3: { cellWidth: anchoNombres, halign: 'left' },
  };
  for (let i = 0; i < totalDias; i++) {
    columnStyles[4 + i] = { cellWidth: anchoDia, halign: 'center' };
  }
  columnStyles[4 + totalDias] = { cellWidth: anchoObservacion, halign: 'left' };

  doc.autoTable({
    head, body,
    startY: 26,
    margin: { top: 26, left: margenLateral, right: margenLateral },
    tableWidth: anchoUtil,
    theme: 'grid',
    styles: { fontSize: 6, cellPadding: 1, lineColor: [150, 150, 150], lineWidth: 0.1, overflow: 'linebreak' },
    headStyles: { fillColor: NAVY, textColor: BLANCO },
    columnStyles,
    didParseCell: (hookData) => {
      // Pintar de amarillo las columnas de días (índices 4 al 4+totalDias-1) en el cuerpo
      const idx = hookData.column.index;
      if (hookData.section === 'body' && idx >= 4 && idx < 4 + totalDias) {
        hookData.cell.styles.fillColor = AMARILLO;
      }
      // Achicar la letra de Apellidos y Nombres (columna 3) si el texto no cabe en una línea
      if (hookData.section === 'body' && idx === 3) {
        const texto = String(hookData.cell.raw || '');
        const cellPadding = 1;
        const anchoDisponible = anchoNombres - (cellPadding * 2);
        let fs = 6;
        doc.setFont(undefined, 'normal');
        doc.setFontSize(fs);
        while (fs > 3.5 && doc.getTextWidth(texto) > anchoDisponible) {
          fs -= 0.5;
          doc.setFontSize(fs);
        }
        hookData.cell.styles.fontSize = fs;
      }
    },
    didDrawPage: () => {
      dibujarBanner();
    }
  });

  const altoPagina = doc.internal.pageSize.getHeight();
  let y = doc.lastAutoTable.finalY + 6;
  doc.setDrawColor(150, 150, 150);
  doc.setLineWidth(0.1);

  // ── Verificar espacio disponible: si Nomenclatura + Certificación + firma
  //    no caben en lo que queda de la página, saltar a una nueva página ──
  const altoNomenclatura = 6 + (CODIGOS_VALIDOS.length * 4.6);
  const altoCertificacionYFirma = 6 + 6 + 8 + 18;
  const margenInferior = 12;
  const altoNecesario = 6 /* espacio antes de nomenclatura */ + altoNomenclatura + 6 + altoCertificacionYFirma;
  if (y + altoNecesario > altoPagina - margenInferior) {
    doc.addPage();
    dibujarBanner();
    y = 30;
  }

  // ── Nomenclatura ──
  doc.setFillColor(...NAVY);
  doc.rect(10, y, anchoPagina - 20, 6, 'FD');
  doc.setTextColor(...BLANCO);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('NOMENCLATURA', anchoPagina / 2, y + 4.2, { align: 'center' });
  doc.setTextColor(0, 0, 0);
  y += 6;

  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  const altoFilaNom = 4.6;
  CODIGOS_VALIDOS.forEach(c => {
    doc.setFillColor(...VERDE_CLARO);
    doc.rect(10, y, anchoPagina - 20, altoFilaNom, 'FD');
    doc.setFont(undefined, 'bold');
    doc.text(c, 12, y + 3.2);
    doc.setFont(undefined, 'normal');
    doc.text(`— ${CODIGOS_DESC[c]}`, 24, y + 3.2);
    y += altoFilaNom;
  });

  y += 6;

  // ── Certificación ──
  doc.setFillColor(...NAVY);
  doc.rect(10, y, anchoPagina - 20, 6, 'FD');
  doc.setTextColor(...BLANCO);
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('CERTIFICACIÓN', anchoPagina / 2, y + 4.2, { align: 'center' });
  y += 6;

  const mitadPagina = anchoPagina / 2;
  const anchoCol = mitadPagina - 12;

  // Fila de etiquetas
  doc.setFillColor(...NAVY);
  doc.rect(10, y, anchoCol, 6, 'FD');
  doc.rect(mitadPagina + 2, y, anchoCol, 6, 'FD');
  doc.setTextColor(...BLANCO);
  doc.setFontSize(8);
  doc.text('ELABORADO POR', 10 + anchoCol / 2, y + 4.2, { align: 'center' });
  doc.text('RESPONSABLE', mitadPagina + 2 + anchoCol / 2, y + 4.2, { align: 'center' });
  y += 6;

  // Fila de valores
  doc.setFillColor(...AMARILLO);
  doc.rect(10, y, anchoCol, 8, 'FD');
  doc.rect(mitadPagina + 2, y, anchoCol, 8, 'FD');
  doc.setTextColor(0, 0, 0);
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(elaboradoPor, 10 + anchoCol / 2, y + 5.2, { align: 'center' });
  doc.text(responsable, mitadPagina + 2 + anchoCol / 2, y + 5.2, { align: 'center' });
  y += 8;

  // ── Recuadro de firma (en blanco) ──
  doc.setDrawColor(0, 0, 0);
  doc.setFillColor(255, 255, 255);
  doc.rect(10, y, anchoCol, 18, 'FD');
  doc.rect(mitadPagina + 2, y, anchoCol, 18, 'FD');

  // ── Contador de páginas (pie de cada hoja) ──
  const totalPaginas = doc.internal.getNumberOfPages();
  for (let p = 1; p <= totalPaginas; p++) {
    doc.setPage(p);
    doc.setFontSize(9);
    doc.setFont(undefined, 'bold');
    doc.setTextColor(0, 0, 0);
    doc.text(`Página ${p} de ${totalPaginas}`, anchoPagina - 12, altoPagina - 4, { align: 'right' });
  }

  doc.save(`novedades_${area}_${periodo}.pdf`);
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Importar BD
═════════════════════════════════════════ */


/* ══════════════════════════════════
   AREAS
══════════════════════════════════ */
function poblarAreas(selectId, placeholder='— Seleccione su área —') {
  const sel = $(selectId); if (!sel) return;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  AREAS.forEach(a => { const o=document.createElement('option'); o.value=a; o.textContent=a; sel.appendChild(o); });
}

/* ══════════════════════════════════
   FILTROS — MES / AÑO (panel admin)
══════════════════════════════════ */
const MESES_FILTRO = ['Enero','Febrero','Marzo','Abril','Mayo','Junio',
  'Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

function poblarFiltroMes() {
  const sel = $('filtro-mes'); if (!sel) return;
  sel.innerHTML = '<option value="">Todos los meses</option>';
  MESES_FILTRO.forEach((m,i) => {
    const o = document.createElement('option');
    o.value = String(i+1).padStart(2,'0');
    o.textContent = m;
    sel.appendChild(o);
  });
}

/* Se llama cada vez que se cargan datos en el panel admin, para que
   el listado de años refleje los años que realmente tienen envíos */
function poblarFiltroAnio(docs) {
  const sel = $('filtro-anio'); if (!sel) return;
  const valorPrevio = sel.value;
  const anios = [...new Set((docs||[]).map(d => (d.timestamp||'').slice(0,4)).filter(Boolean))]
    .sort((a,b) => b.localeCompare(a));
  const anioActual = String(new Date().getFullYear());
  if (!anios.includes(anioActual)) anios.unshift(anioActual);

  sel.innerHTML = '<option value="">Todos los años</option>';
  anios.forEach(a => {
    const o = document.createElement('option'); o.value=a; o.textContent=a; sel.appendChild(o);
  });
  if (anios.includes(valorPrevio)) sel.value = valorPrevio;
}

/* ══════════════════════════════════
   VISTA SUBIR
══════════════════════════════════ */
function irEnvios() {
  archivoSeleccionado = null;
  informeSeleccionado = null;
  actaSeleccionada    = null;
  const fi=$('file-input');    if(fi) fi.value='';
  const ii=$('informe-input'); if(ii) ii.value='';
  const ai=$('acta-input');    if(ai) ai.value='';
  $('dropzone').style.display    = 'flex';
  $('file-preview').style.display = 'none';
  const id=$('informe-dropzone'); if(id) id.style.display='flex';
  const ip=$('informe-preview');  if(ip) ip.style.display='none';
  const ad=$('acta-dropzone'); if(ad) ad.style.display='flex';
  const ap=$('acta-preview');  if(ap) ap.style.display='none';
  $('progress-wrap').style.display = 'none';
  $('area-select').value = '';
  const det=$('detalle-envio'); if(det) det.value='';
  const bar=$('progress-bar'); if(bar) bar.style.width='0%';
  const ptxt=$('progress-txt'); if(ptxt) ptxt.textContent='0%';
  resetBtn();
  actualizarContadorActa();
  const hn=$('hero-nombre'); if(hn) hn.textContent=usuario?.nombre||usuario?.email||'';
  ir('vista-envios');
  cargarMisEnvios();
}

/* ══════════════════════════════════
   MIS ENVÍOS
══════════════════════════════════ */
async function cargarMisEnvios() {
  const lista=$('mis-envios-lista'); if(!lista||!usuario) return;
  lista.innerHTML=`<div class="mis-envios-vacio"><p style="font-size:12px;color:var(--txt3);">Cargando envíos...</p></div>`;
  try {
    const {where}=await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    const q=window._fb.query(window._fb.collection(db,'entregas'),where('uid','==',usuario.uid));
    const snap=await window._fb.getDocs(q);
    const docs=snap.docs.map(d=>({id:d.id,...d.data()}))
      .sort((a,b)=>(b.timestamp||'').localeCompare(a.timestamp||''));
    if(!docs.length){
      lista.innerHTML=`<div class="mis-envios-vacio">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <p>No hay envíos registrados todavía.</p></div>`;
      return;
    }
    lista.innerHTML=docs.map(d=>`
      <div class="mis-envio-item${d.archivado?' mei-archivado':''}" id="mei-${d.id}">
        <div class="mei-ico"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#2563eb" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
        <div class="mei-info">
          <div class="mei-nombre">${d.nombreArchivo}</div>
          <div class="mei-meta">
            <span class="mei-area">${d.area||'—'}</span>
            &nbsp;·&nbsp;${d.fechaTexto} · ${d.horaTexto}
            &nbsp;·&nbsp;${d.tamanoTexto||'—'}
            ${d.archivado
              ? '&nbsp;·&nbsp;<span style="color:var(--txt3);font-size:10px;font-weight:600;">Archivado</span>'
              : '&nbsp;·&nbsp;<span style="color:var(--blue);font-size:10px;font-weight:500;">↩ Subir de nuevo este mes reemplaza este envío</span>'}
            ${d.comprobanteURL
              ? `&nbsp;·&nbsp;<a href="${d.comprobanteURL}" target="_blank" style="color:#16a34a;font-size:10px;font-weight:600;">🧾 Ver comprobante</a>`
              : ''}
          </div>
        </div>
      </div>`).join('');
  } catch(e) {
    lista.innerHTML=`<div class="mis-envios-vacio"><p style="color:var(--red);font-size:11px;">Error: ${e.message}</p></div>`;
  }
}

/* ══════════════════════════════════
   DOM READY
══════════════════════════════════ */
document.addEventListener('DOMContentLoaded', async () => {
  initFirebase().catch(e => console.error(e));
  poblarAreas('area-select');
  poblarAreas('filtro-area', 'Todas las áreas');
  poblarFiltroMes();
  await new Promise(r => setTimeout(r, 100));

  /* botones */
  $('btn-google')?.addEventListener('click', login);
  document.querySelectorAll('.btn-logout').forEach(b => b.addEventListener('click', logout));
  $('nb-novedades')?.addEventListener('click', () => usuario ? irNovedades() : ir('vista-login'));
  $('nb-envios')?.addEventListener('click', () => usuario ? irEnvios() : ir('vista-login'));
  $('nb-admin')?.addEventListener('click', irAdmin);
  $('nb-reportes')?.addEventListener('click', () => { if (esSupervisor() || tienePermisoAccion('actividad_ver')) irReportes(); });
  $('btn-enviar-otro')?.addEventListener('click', irEnvios);
  $('btn-enviar')?.addEventListener('click', enviarArchivo);
  $('btn-filtrar')?.addEventListener('click', aplicarFiltros);
  $('btn-limpiar')?.addEventListener('click', limpiarFiltros);
  $('btn-excel')?.addEventListener('click', () => exportarExcel(docsAdmin, false));
  $('btn-excel-filtrado')?.addEventListener('click', exportarFiltrado);

  /* pestañas del Panel de Control (Envíos / Importar BD / Accesos / Auditoría / Desbloqueos) */
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      if (tabName !== 'permisos' && !tabPermitido(tabName)) return; // defensa extra, el botón ya está oculto
      if (tabName === 'permisos' && !esAdmin()) return;
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const content = $(`admin-tab-${tabName}`);
      if (content) content.style.display = 'block';
      if (tabName === 'envios')      cargarAdmin();
      if (tabName === 'accesos')     cargarAccesos();
      if (tabName === 'auditoria')   cargarAuditoria();
      if (tabName === 'desbloqueos') { cargarDesbloqueos(); poblarSelectoresDesbloqueoDirecto(); }
      if (tabName === 'resumen') { poblarSelectoresResumen(); cargarResumenGeneral(); }
      if (tabName === 'importar') { poblarSelectoresLimpieza(); cargarDirectorioPersonal(); }
      if (tabName === 'permisos') { poblarListaPermisos(); actualizarVisibilidadTabsPermiso(); }
      aplicarPermisosBotones();
    });
  });


  /* dropzone Excel */
  const dz = $('dropzone');
  if (dz) {
    dz.addEventListener('dragover',  e => { e.preventDefault(); dz.classList.add('dz-over'); });
    dz.addEventListener('dragleave', () => dz.classList.remove('dz-over'));
    dz.addEventListener('drop',      e => { e.preventDefault(); dz.classList.remove('dz-over'); if(e.dataTransfer.files[0]) seleccionar(e.dataTransfer.files[0]); });
    dz.addEventListener('click',     abrirSelectorArchivo);
  }
  $('file-input')?.addEventListener('change', () => { if($('file-input').files[0]) seleccionar($('file-input').files[0]); });

  /* botón cambiar Excel */
  $('btn-cambiar')?.addEventListener('click', () => {
    archivoSeleccionado = null;
    $('file-preview').style.display = 'none';
    $('dropzone').style.display = 'flex';
    const fi=$('file-input'); if(fi) fi.value='';
    actualizarBotonEnviar();
  });
});

/* ══════════════════════════════════
   SELECTORES DE ARCHIVO
══════════════════════════════════ */
function abrirSelectorArchivo() {
  const i=document.createElement('input'); i.type='file'; i.accept='.rar,.zip'; i.style.display='none';
  i.addEventListener('change', () => { if(i.files[0]) seleccionar(i.files[0]); i.remove(); });
  document.body.appendChild(i); i.click();
}

function abrirSelectorActa() {
  const i=document.createElement('input'); i.type='file'; i.accept='.pdf'; i.style.display='none';
  i.addEventListener('change', () => { if(i.files[0]) seleccionarActa(i.files[0]); i.remove(); });
  document.body.appendChild(i); i.click();
}

function abrirSelectorInforme() {
  const i=document.createElement('input'); i.type='file'; i.accept='.pdf'; i.style.display='none';
  i.addEventListener('change', () => { if(i.files[0]) seleccionarInforme(i.files[0]); i.remove(); });
  document.body.appendChild(i); i.click();
}

function seleccionarInforme(f) {
  if (!f) return;
  if (f.name.split('.').pop().toLowerCase() !== 'pdf') { toast('El informe debe ser PDF (.pdf)','err'); return; }
  informeSeleccionado = f;
  const iNombre=$('informe-nombre'); if(iNombre) iNombre.textContent=f.name;
  const iPeso=$('informe-peso');     if(iPeso)   iPeso.textContent=formatSize(f.size);
  const idz=$('informe-dropzone');   if(idz) idz.style.display='none';
  const iprev=$('informe-preview');  if(iprev) iprev.style.display='flex';
  actualizarBotonEnviar();
}

function quitarInforme() {
  informeSeleccionado = null;
  const idz=$('informe-dropzone');  if(idz) idz.style.display='flex';
  const iprev=$('informe-preview'); if(iprev) iprev.style.display='none';
  const ii=$('informe-input'); if(ii) ii.value='';
  actualizarBotonEnviar();
}

function quitarActa() {
  actaSeleccionada = null;
  const ad=$('acta-dropzone'); if(ad) ad.style.display='flex';
  const ap=$('acta-preview');  if(ap) ap.style.display='none';
  actualizarBotonEnviar();
}

function seleccionar(f) {
  const ext = f.name.split('.').pop().toLowerCase();
  if (!['rar','zip'].includes(ext)) { toast('Solo se aceptan archivos comprimidos (.rar o .zip)','err'); return; }
  archivoSeleccionado = f;
  $('fp-nombre').textContent = f.name;
  $('fp-peso').textContent   = formatSize(f.size);
  const m=$('fp-modo'); if(m) m.textContent='☁️ Google Drive';
  $('dropzone').style.display     = 'none';
  $('file-preview').style.display = 'flex';
  actualizarBotonEnviar();
}

function seleccionarActa(f) {
  if (!f) return;
  if (f.name.split('.').pop().toLowerCase() !== 'pdf') { toast('El acta debe ser PDF (.pdf)','err'); return; }
  actaSeleccionada = f;
  const an=$('acta-nombre'); if(an) an.textContent=f.name;
  const ap2=$('acta-peso');  if(ap2) ap2.textContent=formatSize(f.size);
  const ad=$('acta-dropzone'); if(ad) ad.style.display='none';
  const ap=$('acta-preview');  if(ap) ap.style.display='flex';
  actualizarBotonEnviar();
}

/* ══════════════════════════════════
   NOMBRADO DE ARCHIVOS — NRO_MES_MES_AREA_AÑO
   El mes que se usa es el MES REPORTADO (mes anterior al
   día de envío), no el mes calendario en que se sube.
══════════════════════════════════ */
const MESES_ES = ['ENERO','FEBRERO','MARZO','ABRIL','MAYO','JUNIO',
  'JULIO','AGOSTO','SEPTIEMBRE','OCTUBRE','NOVIEMBRE','DICIEMBRE'];

function obtenerMesReporte() {
  const ahora = new Date();
  return new Date(ahora.getFullYear(), ahora.getMonth() - 1, 1);
}

function normalizarParaArchivo(txt) {
  return (txt || '').toString()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quitar tildes
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, '')                          // quitar espacios/guiones/etc.
    .trim();
}

function nombreBaseEnvio(areaVal) {
  const mesReporte = obtenerMesReporte();
  const mesNum     = String(mesReporte.getMonth() + 1).padStart(2, '0');
  const mesNombre  = MESES_ES[mesReporte.getMonth()];
  const anio       = mesReporte.getFullYear();
  const areaSlug   = normalizarParaArchivo(areaVal);
  return `${mesNum}_${mesNombre}_${areaSlug}_${anio}`;
}

/* ══════════════════════════════════
   LÓGICA DE PLAZO / ACTA OBLIGATORIA
   Plazo: día 2 del mes. Después del día 2 es tardío y
   se vuelven obligatorios los tres archivos.
══════════════════════════════════ */
function actaEsObligatoriaHoy() {
  return new Date().getDate() > 2;
}

function infoPlazoPorFecha() {
  const ahora           = new Date();
  const dia             = ahora.getDate();
  const mesPasado       = obtenerMesReporte();
  const nombreMesPasado = mesPasado.toLocaleDateString('es-EC',
    { month:'long', year:'numeric', timeZone:'America/Guayaquil' });

  if (dia <= 2) {
    const diasRestantes = 2 - dia;
    return {
      tardio: false,
      mesReporte: nombreMesPasado,
      mensaje: diasRestantes === 0
        ? `Hoy vence el plazo para el reporte de ${nombreMesPasado}`
        : `Envío del reporte de ${nombreMesPasado} · te quedan ${diasRestantes} día${diasRestantes!==1?'s':''} sin acta`
    };
  } else {
    const diasRetraso = dia - 2;
    return {
      tardio: true,
      mesReporte: nombreMesPasado,
      mensaje: `Envío tardío del reporte de ${nombreMesPasado} · ${diasRetraso} día${diasRetraso!==1?'s':''} de retraso — Acta obligatoria`
    };
  }
}

/* Devuelve true si aún estamos antes del día 10 (el dropzone debe estar bloqueado) */
function actaEstaDeshabilitada() {
  return !actaEsObligatoriaHoy();
}

/* Actualiza el contador regresivo / aviso vencimiento del Informativo de Atraso */
function actualizarContadorActa() {
  const cBox = $('acta-countdown');
  const cTxt = $('acta-countdown-txt');
  const dz   = $('acta-dropzone');
  const lbl  = $('acta-label-oblig');
  if (!cBox || !cTxt) return;

  const actaObligatoria = actaEsObligatoriaHoy();
  const dia = new Date().getDate();

  if (!actaObligatoria) {
    /* Antes del día 2: mostrar cuenta regresiva, bloquear dropzone */
    const diasRestantes = 2 - dia;
    cBox.style.background   = '#fef2f2';
    cBox.style.borderColor  = '#fecaca';
    cBox.querySelector('svg').style.stroke = '#ef4444';
    cTxt.style.color = '#ef4444';
    cTxt.textContent = diasRestantes === 0
      ? '⏰ ¡Hoy vence el plazo! Mañana será obligatorio'
      : `⏳ Faltan ${diasRestantes} día${diasRestantes !== 1 ? 's' : ''} para que el Informe de Atraso sea obligatorio`;

    if (dz) {
      dz.style.opacity = '0.45';
      dz.style.cursor  = 'not-allowed';
      dz.style.pointerEvents = 'none';
    }
    if (lbl) {
      lbl.textContent = `OBLIGATORIO EN ${diasRestantes} DÍA${diasRestantes !== 1 ? 'S' : ''}`;
      lbl.style.background = '#ef4444';
    }
  } else {
    /* Después del día 2: habilitado y en rojo urgente */
    const diasRetraso = dia - 2;
    cBox.style.background   = '#fff1f2';
    cBox.style.borderColor  = '#fda4af';
    cBox.querySelector('svg').style.stroke = '#dc2626';
    cTxt.style.color = '#dc2626';
    cTxt.textContent = `🚨 Envío tardío — ${diasRetraso} día${diasRetraso !== 1 ? 's' : ''} de retraso · El Informe de Atraso es OBLIGATORIO`;

    if (dz) {
      dz.style.opacity = '1';
      dz.style.cursor  = 'pointer';
      dz.style.pointerEvents = 'auto';
    }
    if (lbl) {
      lbl.textContent = 'OBLIGATORIO — Envío tardío';
      lbl.style.background = '#ef4444';
    }
  }
}

function actualizarBotonEnviar() {
  const btn = $('btn-enviar'); if (!btn) return;
  const actaObligatoria = actaEsObligatoriaHoy();

  /* Actualizar visual del contador */
  actualizarContadorActa();

  /* Si no es obligatoria y había algo seleccionado, limpiarlo */
  if (!actaObligatoria && actaSeleccionada) {
    actaSeleccionada = null;
    const ai=$('acta-input'); if(ai) ai.value='';
    const ad=$('acta-dropzone'); if(ad) ad.style.display='flex';
    const ap=$('acta-preview');  if(ap) ap.style.display='none';
  }

  const listo = !!(archivoSeleccionado && informeSeleccionado && (actaSeleccionada || !actaObligatoria));
  btn.disabled = !listo;
  btn.style.opacity = listo ? '1' : '0.45';
  btn.style.cursor  = listo ? 'pointer' : 'not-allowed';

  const hint = $('enviar-hint');
  if (hint) {
    if (!archivoSeleccionado)
      hint.textContent = 'Suba el archivo comprimido (RAR o ZIP) para habilitar el envío';
    else if (!informeSeleccionado)
      hint.textContent = '⚠️ El Informe de Entrega PDF es obligatorio';
    else if (!actaSeleccionada && actaObligatoria)
      hint.textContent = '⚠️ El Informe de Atraso es obligatorio — pasó el día 2';
    else
      hint.textContent = '';
  }
}

function formatSize(b) {
  return b >= 1024*1024 ? (b/(1024*1024)).toFixed(2)+' MB' : (b/1024).toFixed(1)+' KB';
}

function setProgreso(pct, label) {
  $('progress-bar').style.width = pct+'%';
  $('progress-txt').textContent = pct+'%';
  const l=$('progress-label-txt'); if(l) l.textContent=label||'';
}

/* ══════════════════════════════════
   GOOGLE DRIVE — TOKEN
══════════════════════════════════ */
function obtenerTokenDrive(forzarNuevo=false) {
  if (!forzarNuevo && _driveTokenCache && Date.now() < _driveTokenExpiry)
    return Promise.resolve(_driveTokenCache);
  return new Promise((resolve, reject) => {
    const cargarGIS = () => new Promise((res, rej) => {
      if (window.google?.accounts?.oauth2) { res(); return; }
      const s = document.createElement('script');
      s.src = 'https://accounts.google.com/gsi/client';
      s.onload = res; s.onerror = () => rej(new Error('No se pudo cargar Google Identity Services'));
      document.head.appendChild(s);
    });
    cargarGIS().then(() => {
      const client = google.accounts.oauth2.initTokenClient({
        client_id: GDRIVE_CONFIG.clientId,
        scope: GDRIVE_CONFIG.scope,
        callback: (resp) => {
          if (resp.error) { reject(new Error('Error de autorización: ' + resp.error)); return; }
          _driveTokenCache  = resp.access_token;
          _driveTokenExpiry = Date.now() + 45 * 60 * 1000;
          toast('✓ Conectado a Google Drive');
          resolve(resp.access_token);
        }
      });
      client.requestAccessToken();
    }).catch(e => reject(e));
  });
}

/* ══════════════════════════════════
   GOOGLE DRIVE — CARPETA POR ÁREA
══════════════════════════════════ */
async function obtenerOCrearSubcarpeta(token, nombreArea) {
  const q = encodeURIComponent(
    `mimeType='application/vnd.google-apps.folder' and name='${nombreArea}' and '${GDRIVE_CARPETA_GENERAL}' in parents and trashed=false`
  );
  const sr = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=1`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  if (!sr.ok) throw new Error('Error buscando carpeta: HTTP ' + sr.status);
  const sd = await sr.json();
  if (sd.files?.length > 0) return sd.files[0].id;

  const cr = await fetch('https://www.googleapis.com/drive/v3/files', {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: nombreArea, mimeType: 'application/vnd.google-apps.folder', parents: [GDRIVE_CARPETA_GENERAL] })
  });
  if (!cr.ok) { const e=await cr.json(); throw new Error(e.error?.message||cr.status); }
  const carpeta = await cr.json();
  await fetch(`https://www.googleapis.com/drive/v3/files/${carpeta.id}/permissions`, {
    method: 'POST',
    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' })
  });
  toast(`📁 Carpeta "${nombreArea}" creada ✓`);
  return carpeta.id;
}

/* ══════════════════════════════════
   GOOGLE DRIVE — HELPERS DE NOMBRADO
══════════════════════════════════ */
function mimeTypePorExtension(ext) {
  const e = (ext||'').toLowerCase();
  if (e === 'zip') return 'application/zip';
  if (e === 'rar') return 'application/vnd.rar';
  if (e === 'pdf') return 'application/pdf';
  return 'application/octet-stream';
}

/* Busca archivos con un nombre exacto dentro de una carpeta */
async function buscarArchivoEnCarpeta(token, idCarpeta, nombre) {
  const q = encodeURIComponent(
    `name='${nombre.replace(/'/g,"\\'")}' and '${idCarpeta}' in parents and trashed=false`
  );
  const r = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)&pageSize=10`,
    { headers: { 'Authorization': 'Bearer ' + token } }
  );
  if (!r.ok) return [];
  const d = await r.json();
  return d.files || [];
}

/* Si ya existe un archivo con ese nombre en la carpeta (mismo mes/área), lo elimina
   antes de subir el nuevo — así no se acumulan duplicados del mismo reporte */
async function eliminarSiExiste(token, idCarpeta, nombre) {
  try {
    const existentes = await buscarArchivoEnCarpeta(token, idCarpeta, nombre);
    for (const f of existentes) {
      await fetch(`https://www.googleapis.com/drive/v3/files/${f.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': 'Bearer ' + token }
      });
    }
  } catch(e) {
    console.warn('No se pudo verificar/eliminar archivo previo en Drive:', e.message);
  }
}

/* ══════════════════════════════════
   GOOGLE DRIVE — SUBIR ARCHIVO
══════════════════════════════════ */
async function subirAGoogleDrive(archivo, nombreFinal, onProgress) {
  const token = await obtenerTokenDrive();
  const area  = $('area-select')?.value;
  if (!area) throw new Error('No se seleccionó área');
  const idSubcarpeta = await obtenerOCrearSubcarpeta(token, area);
  onProgress(25);

  await eliminarSiExiste(token, idSubcarpeta, nombreFinal);
  onProgress(40);

  const ext = nombreFinal.split('.').pop();

  return new Promise((resolve, reject) => {
    const metadata = {
      name:     nombreFinal,
      mimeType: archivo.type || mimeTypePorExtension(ext),
      parents:  [idSubcarpeta]
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', archivo);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = e => { if(e.lengthComputable) onProgress(Math.round(40 + (e.loaded/e.total)*50)); };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        fetch(`https://www.googleapis.com/drive/v3/files/${resp.id}/permissions`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' })
        }).finally(() => resolve(`https://drive.google.com/file/d/${resp.id}/view`));
      } else {
        reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    xhr.send(form);
  });
}

/* ══════════════════════════════════
   GOOGLE DRIVE — SUBIR PDF GENÉRICO
══════════════════════════════════ */
async function subirPDFaGoogleDrive(archivo, nombreFinal, onProgress) {
  const token = await obtenerTokenDrive();
  const area  = $('area-select')?.value;
  if (!area) throw new Error('No se seleccionó área');
  const idSubcarpeta = await obtenerOCrearSubcarpeta(token, area);
  if (onProgress) onProgress(25);

  await eliminarSiExiste(token, idSubcarpeta, nombreFinal);
  if (onProgress) onProgress(40);

  return new Promise((resolve, reject) => {
    const metadata = {
      name:     nombreFinal,
      mimeType: 'application/pdf',
      parents:  [idSubcarpeta]
    };
    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', archivo);

    const xhr = new XMLHttpRequest();
    xhr.open('POST', 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink');
    xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.upload.onprogress = e => { if(e.lengthComputable && onProgress) onProgress(Math.round(40 + (e.loaded/e.total)*50)); };
    xhr.onload = () => {
      if (xhr.status === 200) {
        const resp = JSON.parse(xhr.responseText);
        fetch(`https://www.googleapis.com/drive/v3/files/${resp.id}/permissions`, {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ role: 'reader', type: 'anyone' })
        }).finally(() => resolve(`https://drive.google.com/file/d/${resp.id}/view`));
      } else {
        reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText));
      }
    };
    xhr.onerror = () => reject(new Error('Error de red'));
    xhr.send(form);
  });
}

/* ══════════════════════════════════
   GOOGLE DRIVE — SUBIR COMPROBANTE PDF
══════════════════════════════════ */
async function subirComprobantePDFaDrive(dataUrl, registro) {
  try {
    const token    = await obtenerTokenDrive();
    const base64   = dataUrl.split(',')[1];
    const byteChars = atob(base64);
    const bytes    = new Uint8Array(byteChars.length);
    for (let i=0; i<byteChars.length; i++) bytes[i] = byteChars.charCodeAt(i);
    const blob     = new Blob([bytes], { type: 'application/pdf' });

    const fecha    = new Date().toISOString().slice(0,10);
    const nombre   = `COMPROBANTE_${registro}_${fecha}.pdf`;
    const metadata = { name: nombre, mimeType: 'application/pdf', parents: [GDRIVE_CARPETA_COMPROBANTES] };

    const form = new FormData();
    form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
    form.append('file', blob, nombre);

    const res = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id',
      { method: 'POST', headers: { 'Authorization': 'Bearer ' + token }, body: form }
    );
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();

    await fetch(`https://www.googleapis.com/drive/v3/files/${data.id}/permissions`, {
      method: 'POST',
      headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' })
    });

    const link = `https://drive.google.com/file/d/${data.id}/view`;
    console.log('✓ Comprobante PDF subido a Drive:', link);
    return link;
  } catch(e) {
    console.warn('⚠️ No se pudo subir comprobante a Drive:', e.message);
    return null;
  }
}

/* ══════════════════════════════════
   ENVIAR ARCHIVO — FLUJO PRINCIPAL
══════════════════════════════════ */
async function enviarArchivo() {
  if (!archivoSeleccionado) { toast('Seleccione un archivo comprimido (RAR o ZIP) primero','err'); return; }
  if (!informeSeleccionado) { toast('El Informe de Entrega PDF es obligatorio','err'); return; }

  const actaObligatoria = actaEsObligatoriaHoy();
  if (actaObligatoria && !actaSeleccionada) {
    const _info = infoPlazoPorFecha();
    toast(`⚠️ Envío tardío del reporte de ${_info.mesReporte} — el Acta PDF es obligatoria`, 'err');
    return;
  }

  const areaVal    = $('area-select').value;
  if (!areaVal) { toast('Debe seleccionar su área','err'); return; }
  const detalleVal = ($('detalle-envio')?.value||'').trim();

  /* Nombres estandarizados: NRO_MES_MES_AREA_AÑO (+ sufijo según tipo) */
  const nombreBase        = nombreBaseEnvio(areaVal);
  const extArchivo        = (archivoSeleccionado.name.split('.').pop()||'').toLowerCase();
  const nombreArchivoFinal = `${nombreBase}.${extArchivo}`;
  const nombreInformeFinal = `${nombreBase}_INFORME.pdf`;
  const nombreActaFinal    = actaSeleccionada ? `${nombreBase}_ATRASO.pdf` : null;

  const btn = $('btn-enviar');
  btn.disabled = true;
  btn.innerHTML = '<span class="spinner"></span> Subiendo...';
  $('progress-wrap').style.display = 'block';
  setProgreso(5, 'Preparando...');

  try {
    const ahora      = new Date();
    const fechaTexto = ahora.toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'});
    const horaTexto  = ahora.toLocaleTimeString('es-EC',{timeZone:'America/Guayaquil',hour:'2-digit',minute:'2-digit',second:'2-digit'});

    /* 1. Subir archivo comprimido (RAR/ZIP) */
    setProgreso(10, 'Subiendo archivo a Google Drive...');
    const storageURL = await subirAGoogleDrive(archivoSeleccionado, nombreArchivoFinal,
      p => setProgreso(10 + Math.round(p*0.20), `Subiendo archivo... ${Math.round(p)}%`));

    /* 2. Subir Informe de Entrega PDF (obligatorio) */
    setProgreso(35, 'Subiendo Informe de Entrega PDF...');
    const informeURL = await subirPDFaGoogleDrive(informeSeleccionado, nombreInformeFinal,
      p => setProgreso(35 + Math.round(p*0.15), `Subiendo Informe... ${Math.round(p)}%`));

    /* 3. Subir Acta PDF (si existe) */
    let actaURL = null;
    if (actaSeleccionada) {
      setProgreso(55, 'Subiendo Acta PDF...');
      actaURL = await subirPDFaGoogleDrive(actaSeleccionada, nombreActaFinal,
        p => setProgreso(55 + Math.round(p*0.10), `Subiendo Acta... ${Math.round(p)}%`));
    }

    const numRegistro = 'SISCTE-' + Date.now().toString(36).toUpperCase();

    /* 4. Generar comprobante PDF */
    setProgreso(68, 'Generando comprobante PDF...');
    const comprobanteDataUrl = await generarComprobantePDFComoURL({
      nombre:    usuario.nombre,
      email:     usuario.email,
      area:      areaVal,
      archivo:   nombreArchivoFinal,
      informe:   nombreInformeFinal,
      acta:      nombreActaFinal || '—',
      tamano:    formatSize(archivoSeleccionado.size),
      fecha:     fechaTexto,
      hora:      horaTexto,
      registro:  numRegistro,
      driveLink: storageURL,
      informeLink: informeURL || '',
      actaLink:  actaURL || ''
    });

    /* 5. Subir comprobante a Drive */
    setProgreso(78, 'Subiendo comprobante PDF...');
    let comprobanteURL = null;
    if (comprobanteDataUrl) {
      comprobanteURL = await subirComprobantePDFaDrive(comprobanteDataUrl, numRegistro);
    }

    /* 6. Registrar en Firestore (con deduplicación por mes+área) */
    setProgreso(88, 'Registrando en Firestore...');
    const { where, deleteDoc, doc: docRef } =
      await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");

    const qDup = window._fb.query(
      window._fb.collection(db,'entregas'),
      where('uid',          '==', usuario.uid),
      where('nombreArchivo','==', nombreArchivoFinal),
      where('area',         '==', areaVal)
    );
    const snapDup = await window._fb.getDocs(qDup);
    for (const ds of snapDup.docs) {
      await deleteDoc(docRef(db,'entregas',ds.id));
    }
    const fueReemplazo = snapDup.docs.length > 0;

    let driveFileId = null;
    const m = storageURL?.match(/\/d\/([a-zA-Z0-9-_]+)\//);
    if (m) driveFileId = m[1];

    await window._fb.addDoc(window._fb.collection(db,'entregas'), {
      uid:           usuario.uid,
      nombre:        usuario.nombre,
      email:         usuario.email,
      foto:          usuario.foto,
      area:          areaVal,
      nombreArchivo: nombreArchivoFinal,
      nombreOriginal: archivoSeleccionado.name,
      nombreInforme: nombreInformeFinal,
      nombreActa:    nombreActaFinal,
      tamanoBytes:   archivoSeleccionado.size,
      tamanoTexto:   formatSize(archivoSeleccionado.size),
      metodo:        'google_drive',
      storageURL,
      informeURL,
      actaURL,
      comprobanteURL,
      driveFileId,
      detalle:       detalleVal,
      registro:      numRegistro,
      fechaTexto,
      horaTexto,
      timestamp:     ahora.toISOString()
    });

    /* 6. Correos */
    setProgreso(93, 'Enviando correos de notificación...');
    try {
      /* Calcular el link de la carpeta real del área en Drive */
      const _tokenMail = _driveTokenCache;
      let _carpetaAreaId = null;
      if (_tokenMail) {
        try { _carpetaAreaId = await obtenerOCrearSubcarpeta(_tokenMail, areaVal); } catch(e) {}
      }
      const linkCarpetaArea = _carpetaAreaId
        ? `https://drive.google.com/drive/folders/${_carpetaAreaId}`
        : `https://drive.google.com/drive/folders/${GDRIVE_CARPETA_GENERAL}`;

      await enviarCorreosNotificacion({
        nombre:         usuario.nombre,
        email:          usuario.email,
        area:           areaVal,
        archivo:        nombreArchivoFinal,
        informe:        nombreInformeFinal,
        acta:           nombreActaFinal || '—',
        tamano:         formatSize(archivoSeleccionado.size),
        fecha:          fechaTexto,
        hora:           horaTexto,
        registro:       numRegistro,
        driveLink:      storageURL,
        informeLink:    informeURL || null,
        actaLink:       actaURL || null,
        linkCarpeta:    linkCarpetaArea,
        comprobanteUrl: comprobanteURL || ''
      });
    } catch(mailErr) {
      console.error('❌ Error enviando correos:', mailErr);
    }

    setProgreso(100, fueReemplazo ? '¡Archivo reemplazado!' : '¡Completado!');
    mostrarExito(areaVal, fechaTexto, horaTexto, nombreArchivoFinal);
    setTimeout(() => ir('vista-exito'), 500);

  } catch(err) {
    console.error(err);
    toast('Error al subir: ' + (err?.message || 'Error desconocido'), 'err');
    $('progress-wrap').style.display = 'none';
    resetBtn();
  }
}

function mostrarExito(area, fecha, hora, nombreArchivoFinal) {
  $('ex-nombre').textContent  = usuario.nombre;
  $('ex-email').textContent   = usuario.email;
  $('ex-area').textContent    = area;
  $('ex-archivo').textContent = nombreArchivoFinal || archivoSeleccionado.name;
  $('ex-tamano').textContent  = formatSize(archivoSeleccionado.size);
  $('ex-fecha').textContent   = fecha;
  $('ex-hora').textContent    = hora;
}

/* ══════════════════════════════════
   GENERAR COMPROBANTE PDF
══════════════════════════════════ */
async function generarComprobantePDFComoURL(d) {
  try {
    if (!window.jspdf) {
      await new Promise((res,rej) => {
        const s = document.createElement('script');
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';
        s.onload=res; s.onerror=rej; document.head.appendChild(s);
      });
    }
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit:'mm', format:'a4' });
    const W = 210;

    doc.setFillColor(37,99,235);
    doc.rect(0,0,W,50,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(20); doc.setFont('helvetica','bold');
    doc.text('SISCTE', W/2, 22, { align:'center' });
    doc.setFontSize(11); doc.setFont('helvetica','normal');
    doc.text('Portal de Gestión de Envíos · Personal CTE', W/2, 30, { align:'center' });
    doc.setFontSize(9);
    doc.text('Confirmación de entrega registrada exitosamente', W/2, 38, { align:'center' });

    doc.setFillColor(22,163,74);
    doc.circle(W/2, 62, 8, 'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(14); doc.setFont('helvetica','bold');
    doc.text('✓', W/2, 66, { align:'center' });

    doc.setTextColor(17,24,39);
    doc.setFontSize(16); doc.setFont('helvetica','bold');
    doc.text('¡Archivo registrado exitosamente!', W/2, 78, { align:'center' });
    doc.setFontSize(10); doc.setFont('helvetica','normal');
    doc.setTextColor(100,116,139);
    doc.text('Su entrega fue guardada correctamente en el sistema SISCTE.', W/2, 85, { align:'center' });

    const campos = [
      ['ENVIADO POR', d.nombre],
      ['CORREO',      d.email],
      ['ÁREA',        d.area],
      ['ARCHIVO',     d.archivo],
      ['ACTA PDF',    d.acta||'—'],
      ['TAMAÑO',      d.tamano],
      ['FECHA',       d.fecha],
      ['HORA',        d.hora],
    ];
    let y = 95;
    campos.forEach(([lbl,val],i) => {
      doc.setFillColor(i%2===0?248:255, i%2===0?250:255, i%2===0?252:255);
      doc.rect(14, y-5, W-28, 12, 'F');
      doc.setDrawColor(226,232,240); doc.setLineWidth(0.3);
      doc.rect(14, y-5, W-28, 12, 'S');
      doc.setTextColor(148,163,184); doc.setFontSize(7); doc.setFont('helvetica','bold');
      doc.text(lbl, 18, y);
      doc.setTextColor(30,41,59); doc.setFontSize(10); doc.setFont('helvetica','normal');
      const v = String(val||'—');
      doc.text(v.length>55 ? v.substring(0,52)+'...' : v, 70, y);
      y += 13;
    });

    y += 2;
    doc.setFillColor(241,245,249);
    doc.roundedRect(14, y, W-28, 14, 3, 3, 'F');
    doc.setDrawColor(203,213,225); doc.setLineWidth(0.3);
    doc.roundedRect(14, y, W-28, 14, 3, 3, 'S');
    doc.setTextColor(148,163,184); doc.setFontSize(7); doc.setFont('helvetica','bold');
    doc.text('N° DE REGISTRO', 18, y+5);
    doc.setTextColor(26,58,107); doc.setFontSize(12); doc.setFont('helvetica','bold');
    doc.text(d.registro, 70, y+9);

    y += 22;
    doc.setFillColor(255,251,235);
    doc.roundedRect(14, y, W-28, 16, 3, 3, 'F');
    doc.setDrawColor(245,158,11); doc.setLineWidth(0.8);
    doc.line(14, y, 14, y+16);
    doc.setTextColor(120,53,15); doc.setFontSize(8); doc.setFont('helvetica','bold');
    doc.text('Guarde este comprobante como respaldo de su entrega en el sistema SISCTE.', 20, y+6);
    doc.setFont('helvetica','normal');
    doc.text('Su archivo fue almacenado en Google Drive y el registro queda permanente.', 20, y+12);

    doc.setFillColor(37,99,235);
    doc.rect(0, 275, W, 22, 'F');
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text('Sistema SISCTE — Generado el '+d.fecha+' a las '+d.hora, 14, 284);
    doc.text('siscte1-sys.github.io/SIS-CTE', W-14, 284, { align:'right' });
    doc.setFontSize(7); doc.setTextColor(179,207,255);
    doc.text('Este documento es un comprobante automático de su entrega.', W/2, 290, { align:'center' });

    return doc.output('datauristring');
  } catch(e) {
    console.warn('PDF error:', e.message);
    return null;
  }
}

/* ══════════════════════════════════
   GAS MAILER — Notificaciones  v5.6
   ──────────────────────────────────
   CORRECCIONES:
   1. Se abandona el <script> tag (JSONP): GAS redirige a login
      de Google cuando el payload es grande → onload nunca
      dispara con los datos correctos, onerror se ignora.
   2. Se usa fetch() con mode:'no-cors' + method POST.
      • no-cors permite enviar la petición sin preflight.
      • La respuesta es opaca (no se puede leer), pero el
        GAS la recibe y ejecuta _procesarEnvio() sin problema.
   3. El payload ya NO va en la URL (límite ~2000 chars).
      Va en el body como texto plano — GAS lo lee en
      e.postData.contents dentro de doPost().
   4. Se envían los dos correos en secuencia (no en paralelo)
      para evitar que GAS rechace peticiones simultáneas del
      mismo deployment.

   IMPORTANTE: El GAS debe estar desplegado como:
     • Ejecutar como: Yo (el propietario)
     • Quién tiene acceso: Cualquier persona (anónimo)
══════════════════════════════════ */
async function _gasSend(payload) {
  const jsonStr = JSON.stringify(payload);

  // fetch no-cors + POST: sin CORS bloqueante, sin límite de URL
  await fetch(GAS_MAILER_URL, {
    method:  'POST',
    mode:    'no-cors',   // respuesta opaca — aceptable, solo nos importa que llegue
    headers: { 'Content-Type': 'text/plain' },  // 'application/json' dispara preflight en no-cors
    body:    jsonStr
  });
  // no-cors nunca rechaza aunque el servidor devuelva error HTTP —
  // cualquier fallo de red lanzará TypeError, que el caller captura
}

async function enviarCorreoUsuario(datos) {
  await _gasSend({
    tipo:           'usuario',
    email:          datos.email,
    nombre:         datos.nombre,
    area:           datos.area,
    archivo:        datos.archivo,
    informe:        datos.informe     || '—',
    informeLink:    datos.informeLink || '',
    acta:           datos.acta        || '—',
    tamano:         datos.tamano,
    fecha:          datos.fecha,
    hora:           datos.hora,
    registro:       datos.registro,
    comprobanteUrl: datos.comprobanteUrl || ''
  });
  console.log('✓ Correo usuario enviado via GAS');
  toast('Correo de confirmación enviado ✓');
}

async function enviarCorreoAdmin(datos) {
  await _gasSend({
    tipo:        'admin',
    nombre:      datos.nombre,
    email:       datos.email,
    area:        datos.area,
    archivo:     datos.archivo,
    informe:     datos.informe     || '—',
    informeLink: datos.informeLink || '',
    acta:        datos.acta        || '—',
    tamano:      datos.tamano,
    fecha:       datos.fecha,
    hora:        datos.hora,
    registro:    datos.registro,
    driveLink:   datos.driveLink   || '',
    actaLink:    datos.actaLink    || '',
    linkCarpeta: datos.linkCarpeta || `https://drive.google.com/drive/folders/${GDRIVE_CARPETA_GENERAL}`
  });
  console.log('✓ Alerta admin enviada via GAS');
}

async function enviarCorreosNotificacion(datos) {
  // Secuencial: evita que GAS rechace dos peticiones simultáneas
  try {
    await enviarCorreoAdmin(datos);
  } catch(e) {
    console.error('❌ Correo ADMIN no enviado:', e.message);
  }
  try {
    await enviarCorreoUsuario(datos);
  } catch(e) {
    console.error('❌ Correo USUARIO no enviado:', e.message);
    toast('⚠️ No se pudo enviar el correo de confirmación', 'err');
  }
}

/* ══════════════════════════════════
   PANEL ADMIN
══════════════════════════════════ */

/* Abre en una pestaña nueva la carpeta de Drive de un área.
   Los archivos dentro ya quedan identificados por mes gracias
   al nombrado NRO_MES_MES_AREA_AÑO. */
async function abrirCarpetaArea(area) {
  if (!area) { toast('No se encontró el área para abrir la carpeta','err'); return; }
  try {
    toast(`Abriendo carpeta de ${area}...`);
    const token = await obtenerTokenDrive();
    const idCarpeta = await obtenerOCrearSubcarpeta(token, area);
    window.open(`https://drive.google.com/drive/folders/${idCarpeta}`, '_blank');
  } catch(e) {
    toast('Error al abrir la carpeta: ' + e.message, 'err');
  }
}

async function cargarAdmin() {
  $('tabla-body').innerHTML     = `<tr><td colspan="9" class="td-vacio">Cargando...</td></tr>`;
  $('admin-personas').innerHTML = `<p class="cargando-txt">Cargando...</p>`;
  docsAdmin = [];
  try {
    const snap = await window._fb.getDocs(window._fb.collection(db,'entregas'));
    docsAdmin  = snap.docs
      .map(d => ({id:d.id,...d.data()}))
      .sort((a,b) => (b.timestamp||'').localeCompare(a.timestamp||''));
    poblarFiltroAnio(docsAdmin);
    renderAdmin(docsAdmin);
  } catch(e) {
    console.error('cargarAdmin error:', e);
    $('tabla-body').innerHTML = `<tr><td colspan="9" class="td-vacio" style="color:var(--red)">Error al cargar: ${e.message}</td></tr>`;
    toast('Error al cargar: '+e.message,'err');
  }
}

const POR_PAGINA_ENVIOS = 10;
let personasCache = [];
let paginaPersonas = 1;
let docsCache = [];
let paginaArchivos = 1;

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

  personasCache = Object.values(porPersona).sort((a,b)=>b.cant-a.cant);
  docsCache = docs;
  paginaPersonas = 1;
  paginaArchivos = 1;

  renderizarPersonasPagina();
  renderizarArchivosPagina();

  $('filtro-resultado').textContent = `${docs.length} registro${docs.length!==1?'s':''} encontrado${docs.length!==1?'s':''}`;
}

function renderizarControlesPaginacion(contenedorId, totalItems, paginaActual, funcCambiarPagina) {
  const totalPaginas = Math.max(1, Math.ceil(totalItems / POR_PAGINA_ENVIOS));
  const cont = $(contenedorId);
  if (!cont) return;
  if (totalItems <= POR_PAGINA_ENVIOS) { cont.innerHTML = ''; return; }
  cont.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid var(--border);">
      <span style="font-size:12px;color:var(--txt2);">${totalItems} en total — página ${paginaActual} de ${totalPaginas}</span>
      <div style="display:flex;gap:8px;">
        <button class="btn-acc btn-acc-ghost" ${paginaActual<=1?'disabled':''} onclick="${funcCambiarPagina}(-1)">← Anterior</button>
        <button class="btn-acc btn-acc-ghost" ${paginaActual>=totalPaginas?'disabled':''} onclick="${funcCambiarPagina}(1)">Siguiente →</button>
      </div>
    </div>`;
}

function renderizarPersonasPagina() {
  const inicio = (paginaPersonas - 1) * POR_PAGINA_ENVIOS;
  const pagina = personasCache.slice(inicio, inicio + POR_PAGINA_ENVIOS);

  $('admin-personas').innerHTML = pagina.map(p=>`
    <div class="persona-row">
      <img class="persona-foto" src="${p.foto||avatar(p.nombre)}" alt="" onerror="this.src='${avatar(p.nombre)}'">
      <div class="persona-info">
        <div class="persona-nombre">${p.nombre||'—'}</div>
        <div class="persona-email">${p.email}</div>
        <div class="persona-ultima">Área(s): ${[...p.areas].join(', ')||'—'} · Último: ${p.fechaTexto} · ${p.horaTexto}</div>
      </div>
      <button type="button" class="persona-badge persona-badge-link" onclick="abrirCarpetaArea('${p.area||''}')" title="Abrir carpeta de ${p.area||'su área'} en Drive">${p.cant} archivo${p.cant>1?'s':''}</button>
    </div>`).join('') || '<p class="cargando-txt">Sin entregas</p>';

  renderizarControlesPaginacion('admin-personas-paginacion', personasCache.length, paginaPersonas, 'cambiarPaginaPersonasEnvio');
}

function cambiarPaginaPersonasEnvio(delta) {
  const totalPaginas = Math.max(1, Math.ceil(personasCache.length / POR_PAGINA_ENVIOS));
  paginaPersonas = Math.min(totalPaginas, Math.max(1, paginaPersonas + delta));
  renderizarPersonasPagina();
}

function renderizarArchivosPagina() {
  const inicio = (paginaArchivos - 1) * POR_PAGINA_ENVIOS;
  const pagina = docsCache.slice(inicio, inicio + POR_PAGINA_ENVIOS);

  $('tabla-body').innerHTML = !docsCache.length
    ? `<tr><td colspan="9" class="td-vacio">No hay registros</td></tr>`
    : pagina.map((d,i) => `
      <tr class="${d.archivado?'tr-archivado':''}">
        <td class="td-n">${inicio + i + 1}</td>
        <td><div class="td-user">
          <img class="td-foto" src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
          <div><div class="td-nombre">${d.nombre||'—'}</div><div class="td-email">${d.email}</div></div>
        </div></td>
        <td><span class="badge-area">${d.area||'—'}</span></td>
        <td class="td-arch">${renderDescarga(d)}</td>
        <td class="td-detalle" title="${d.detalle||'—'}">${d.detalle?(d.detalle.length>40?d.detalle.slice(0,40)+'…':d.detalle):'<span style="color:#9ca3af">—</span>'}</td>
        <td class="td-peso">${d.tamanoTexto||'—'}</td>
        <td class="td-fecha">${d.fechaTexto}</td>
        <td class="td-hora">${d.horaTexto}</td>
        <td>${d.archivado
          ? `<span class="badge-archivado">Archivado</span>`
          : `<span class="badge-activo">Activo</span>`}</td>
      </tr>`).join('');

  renderizarControlesPaginacion('tabla-body-paginacion', docsCache.length, paginaArchivos, 'cambiarPaginaArchivosEnvio');
}

function cambiarPaginaArchivosEnvio(delta) {
  const totalPaginas = Math.max(1, Math.ceil(docsCache.length / POR_PAGINA_ENVIOS));
  paginaArchivos = Math.min(totalPaginas, Math.max(1, paginaArchivos + delta));
  renderizarArchivosPagina();
}

function renderDescarga(d) {
  const svg=`<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>`;
  if (d.storageURL) return `<a href="${d.storageURL}" target="_blank" class="link-archivo">${svg}${d.nombreArchivo}</a>`;
  return `<span style="color:var(--txt3);font-size:12px;">${d.nombreArchivo||'—'}</span>`;
}

/* ══════════════════════════════════
   FILTROS
══════════════════════════════════ */
function filtrarDocs(docs) {
  const area   = $('filtro-area').value.toLowerCase();
  const nombre = $('filtro-nombre').value.trim().toLowerCase();
  const email  = $('filtro-email').value.trim().toLowerCase();
  const fd     = $('filtro-fecha-desde').value;
  const fh     = $('filtro-fecha-hasta').value;
  const mes    = $('filtro-mes')?.value || '';
  const anio   = $('filtro-anio')?.value || '';
  let r = [...docs];
  if (area)   r=r.filter(d=>(d.area||'').toLowerCase().includes(area));
  if (nombre) r=r.filter(d=>(d.nombre||'').toLowerCase().includes(nombre));
  if (email)  r=r.filter(d=>(d.email||'').toLowerCase().includes(email));
  if (fd)     r=r.filter(d=>d.timestamp>=new Date(fd).toISOString());
  if (fh)     { const h=new Date(fh); h.setHours(23,59,59); r=r.filter(d=>d.timestamp<=h.toISOString()); }
  if (mes)    r=r.filter(d=>(d.timestamp||'').slice(5,7)===mes);
  if (anio)   r=r.filter(d=>(d.timestamp||'').slice(0,4)===anio);
  return r;
}

function aplicarFiltros() { renderAdmin(filtrarDocs(docsAdmin)); }
function limpiarFiltros() {
  ['filtro-area','filtro-nombre','filtro-email','filtro-fecha-desde','filtro-fecha-hasta','filtro-mes','filtro-anio']
    .forEach(id => { const e=$(id); if(e) e.value=''; });
  renderAdmin(docsAdmin);
}
function exportarFiltrado() { exportarExcel(filtrarDocs(docsAdmin), true); }

/* ══════════════════════════════════
   EXPORTAR EXCEL
══════════════════════════════════ */
const avatar = n =>
  `https://ui-avatars.com/api/?name=${encodeURIComponent(n||'?')}&background=1d4ed8&color=fff`;

async function exportarExcel(docs, filtrado=false) {
  if (!window.XLSX) {
    await new Promise((res,rej) => {
      const s=document.createElement('script');
      s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload=res; s.onerror=rej; document.head.appendChild(s);
    });
  }
  const filas = docs.map((d,i) => ({
    '#':i+1, 'Nombre':d.nombre||'—', 'Correo':d.email||'—', 'Área':d.area||'—',
    'Archivo':d.nombreArchivo||'—', 'Acta':d.nombreActa||'—',
    'Descripción':d.detalle||'—', 'Peso':d.tamanoTexto||'—',
    'Fecha':d.fechaTexto||'—', 'Hora':d.horaTexto||'—',
    'Estado':d.archivado?'ARCHIVADO':'Activo',
    'Link Drive':d.storageURL||'—',
    'Link Comprobante':d.comprobanteURL||'—'
  }));
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.json_to_sheet(filas);
  ws['!cols'] = [{wch:4},{wch:28},{wch:34},{wch:22},{wch:38},{wch:30},{wch:40},{wch:12},{wch:22},{wch:14},{wch:12},{wch:50},{wch:50}];
  XLSX.utils.book_append_sheet(wb, ws, 'Entregas');
  XLSX.writeFile(wb, `informe_SISCTE${filtrado?'_filtrado':'_completo'}_${new Date().toISOString().slice(0,10)}.xlsx`);
  toast(`Informe${filtrado?' filtrado':''} descargado ✓`);
}

/* ══════════════════════════════════
   ARCHIVADO MENSUAL
══════════════════════════════════ */
window.verificarChecks = function() {
  const ok = $('check1')?.checked && $('check2')?.checked && $('check3')?.checked;
  const btn = $('arch-btn-descargar'); if(btn) btn.disabled=!ok;
};

function labelMes(ts) {
  return new Date(ts).toLocaleDateString('es-EC',
    { month:'long', year:'numeric', timeZone:'America/Guayaquil' });
}

function abrirModalArchivado() {
  const mesesMap = {};
  docsAdmin.forEach(d => {
    if (d.archivado || !d.storageURL) return;
    const mes = d.timestamp.slice(0,7);
    if (!mesesMap[mes]) mesesMap[mes] = { docs:[], label: labelMes(d.timestamp) };
    mesesMap[mes].docs.push(d);
  });
  const meses = Object.entries(mesesMap).sort((a,b)=>b[0].localeCompare(a[0]));
  if (!meses.length) { toast('No hay archivos pendientes de archivar'); return; }

  const sel = $('arch-mes-select');
  sel.innerHTML = '<option value="">— Seleccione el mes —</option>';
  meses.forEach(([k,v]) => {
    const o=document.createElement('option'); o.value=k;
    o.textContent=`${v.label} (${v.docs.length} archivo${v.docs.length>1?'s':''})`;
    sel.appendChild(o);
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
  if (!mes) return;
  const info = window._archMeses[mes];
  $('arch-resumen').innerHTML = `
    <div class="arch-stat"><span>${info.docs.length}</span> archivos a descargar y archivar</div>
    <div class="arch-personas">${info.docs.map(d=>`
      <div class="arch-persona-row">
        <img src="${d.foto||avatar(d.nombre)}" alt="" onerror="this.src='${avatar(d.nombre)}'">
        <div>
          <div class="arch-persona-nombre">${d.nombre||'—'} <span class="badge-area" style="font-size:10px">${d.area||''}</span></div>
          <div class="arch-persona-archivo">${d.nombreArchivo} · ${d.tamanoTexto||'—'}</div>
        </div>
      </div>`).join('')}</div>`;
}

function archPaso2() {
  const mes = $('arch-mes-select').value; if(!mes) return;
  $('arch-paso1').style.display = 'none'; $('arch-paso2').style.display = 'block';
  const info = window._archMeses[mes];
  $('arch-advertencia-detalle').textContent =
    `Se descargarán ${info.docs.length} archivo(s) de ${labelMes(info.docs[0].timestamp)}. Después podrás eliminar los binarios. El historial quedará guardado.`;
}

async function descargarMesCompleto() {
  const mes = $('arch-mes-select').value;
  const info = window._archMeses[mes];
  $('arch-paso2').style.display = 'none'; $('arch-paso3').style.display = 'block';
  $('arch-progreso-txt').textContent = 'Abriendo archivos de Drive...';
  let ok = 0;
  for (let i=0; i<info.docs.length; i++) {
    const d = info.docs[i];
    $('arch-progreso-bar').style.width = Math.round(((i+1)/info.docs.length)*100)+'%';
    $('arch-progreso-txt').textContent = `Abriendo ${i+1} de ${info.docs.length}: ${d.nombreArchivo}`;
    try { if(d.storageURL) window.open(d.storageURL,'_blank'); ok++; } catch(e) {}
    await new Promise(r => setTimeout(r,400));
  }
  $('arch-progreso-txt').textContent = `✓ ${ok} de ${info.docs.length} archivos abiertos`;
  $('arch-btn-archivar').style.display = 'block';
  $('arch-btn-archivar').onclick = () => confirmarArchivar(mes, info.docs);
}

async function confirmarArchivar(mes, docs) {
  $('arch-btn-archivar').disabled = true; $('arch-btn-archivar').textContent = 'Archivando...';
  try {
    const { doc, updateDoc } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    let p = 0;
    for (const d of docs) {
      $('arch-progreso-bar').style.width = Math.round(((p+1)/docs.length)*100)+'%';
      await updateDoc(doc(db,'entregas',d.id), {
        archivado:      true,
        fechaArchivado: new Date().toISOString(),
        notaArchivado:  `Archivado el ${new Date().toLocaleDateString('es-EC',{timeZone:'America/Guayaquil',day:'2-digit',month:'long',year:'numeric'})}`
      });
      p++; await new Promise(r => setTimeout(r,150));
    }
    $('arch-progreso-txt').textContent = `✓ ${p} registros archivados.`;
    $('arch-btn-archivar').textContent = '✓ Completado';
    setTimeout(async () => {
      cerrarModalArchivado(); await cargarAdmin(); toast(`Mes archivado ✓`);
    }, 2000);
  } catch(e) {
    toast('Error al archivar: '+e.message,'err');
    $('arch-btn-archivar').disabled = false; $('arch-btn-archivar').textContent = 'Reintentar';
  }
}

function cerrarModalArchivado() { $('modal-archivado').style.display = 'none'; }

/* ══════════════════════════════════
   ELIMINAR REGISTROS BD
   FIX v5.2: limpia UI inmediatamente tras borrar
══════════════════════════════════ */
function abrirModalLimpiarDuplicados() {
  $('limpieza-contenido').style.display = 'block';
  $('limpieza-progreso').style.display  = 'none';
  $('check-confirmar').checked = false;
  $('btn-iniciar-limpieza').disabled = true;
  $('elim-preview-result').style.display = 'none';
  $('elim-fecha-desde').value = '';
  $('elim-fecha-hasta').value = new Date().toISOString().slice(0,10);
  $('modal-limpiar-duplicados').style.display = 'flex';
}

function cerrarModalLimpiarDuplicados() { $('modal-limpiar-duplicados').style.display = 'none'; }

window.verificarCheckLimpieza = function() {
  $('btn-iniciar-limpieza').disabled = !$('check-confirmar').checked;
};

async function _obtenerRegistrosEnRango() {
  const fd = $('elim-fecha-desde').value;
  const fh = $('elim-fecha-hasta').value;

  const snap = await window._fb.getDocs(window._fb.collection(db,'entregas'));
  let entregas = snap.docs.map(d => ({id:d.id,...d.data()}));

  if (!fd && !fh) return entregas;

  entregas = entregas.filter(d => {
    if (!d.timestamp) return true;
    const fechaDoc = d.timestamp.slice(0, 10);
    if (fd && fechaDoc < fd) return false;
    if (fh && fechaDoc > fh) return false;
    return true;
  });

  return entregas;
}

window.previsualizarEliminacion = async function() {
  const btn = $('btn-preview-eliminar');
  btn.textContent = 'Consultando...'; btn.disabled = true;
  try {
    const registros = await _obtenerRegistrosEnRango();
    const res = $('elim-preview-result');
    res.style.display = 'block';
    if (!registros.length) {
      res.style.background='#fff7ed'; res.style.borderColor='#fed7aa'; res.style.color='#c2410c';
      res.textContent = '⚠️ No se encontraron registros en ese rango de fechas.';
    } else {
      res.style.background='#f0fdf4'; res.style.borderColor='#bbf7d0'; res.style.color='#15803d';
      res.textContent = `✓ Se eliminarán ${registros.length} registro${registros.length!==1?'s':''} de Firestore (los archivos en Drive no se tocan).`;
    }
  } catch(e) {
    toast('Error al consultar: '+e.message,'err');
  } finally {
    btn.textContent = 'Ver cuántos registros se borrarán'; btn.disabled = false;
  }
};

async function iniciarLimpiezaDuplicados() {
  $('limpieza-contenido').style.display = 'none';
  $('limpieza-progreso').style.display  = 'block';
  $('limpieza-resultados').innerHTML    = '';
  const log = msg => {
    const el=$('limpieza-resultados');
    el.innerHTML += msg+'\n';
    el.scrollTop = el.scrollHeight;
  };
  try {
    log('🔍 Obteniendo registros en el rango seleccionado...\n');
    const entregas = await _obtenerRegistrosEnRango();
    log(`✓ ${entregas.length} registros encontrados\n`);
    if (!entregas.length) {
      log('ℹ️ No hay registros para eliminar en ese rango.');
      $('limpieza-progreso-bar').style.width='100%';
      $('limpieza-progreso-txt').textContent='Sin registros que eliminar';
      setTimeout(() => cerrarModalLimpiarDuplicados(), 2000);
      return;
    }
    const { deleteDoc, doc: dRef } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
    let eliminados = 0;
    for (let i=0; i<entregas.length; i++) {
      const d = entregas[i];
      const pct = Math.round(((i+1)/entregas.length)*100);
      $('limpieza-progreso-bar').style.width = pct+'%';
      $('limpieza-progreso-txt').textContent = `Eliminando ${i+1} de ${entregas.length}...`;
      log(`  🗑️ ${d.nombreArchivo} · ${d.area||'—'} · ${d.fechaTexto||d.timestamp.slice(0,10)}`);
      await deleteDoc(dRef(db,'entregas',d.id));
      eliminados++;
      await new Promise(r => setTimeout(r,80));
    }
    $('limpieza-progreso-bar').style.width='100%';
    $('limpieza-progreso-txt').textContent='✓ Eliminación completada';
    log(`\n✅ ${eliminados} registro${eliminados!==1?'s':''} eliminado${eliminados!==1?'s':''} de Firestore.`);
    log('ℹ️ Los archivos en Google Drive no fueron afectados.');

    docsAdmin = [];
    cerrarModalLimpiarDuplicados();

    const vistaAdmin = $('vista-admin');
    if (vistaAdmin && vistaAdmin.style.display !== 'none') {
      $('tabla-body').innerHTML = `<tr><td colspan="9" class="td-vacio">No hay registros</td></tr>`;
      $('admin-personas').innerHTML = `<p class="cargando-txt">Sin entregas</p>`;
      $('st-total').textContent  = '0';
      $('st-unicos').textContent = '0';
      $('st-ultimo').textContent = 'Sin entregas aún';
      $('filtro-resultado').textContent = '0 registros encontrados';
    }

    const listaMisEnvios = $('mis-envios-lista');
    if (listaMisEnvios) {
      listaMisEnvios.innerHTML = `<div class="mis-envios-vacio">
        <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="#d1d5db" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg>
        <p>No hay envíos registrados todavía.</p></div>`;
    }

    toast(`✓ ${eliminados} registro${eliminados!==1?'s':''} eliminado${eliminados!==1?'s':''}`);

  } catch(e) {
    log(`\n❌ Error: ${e.message}`);
    toast('Error: '+e.message,'err');
  }
}

/* ══════════════════════════════════
   PANEL ADMIN — Novedades (Importar BD, Accesos, Auditoría, Desbloqueos)
══════════════════════════════════ */
function sanitizarNombreArea(area) {
  // Firestore usa "/" como separador de ruta — no puede ir dentro de un nombre de área
  return (area || 'SIN ÁREA').replace(/\//g, '-').replace(/\s+/g, ' ').trim();
}

async function importarBaseDatos() {
  try {
    if (!esAdmin()) {
      toast('❌ Solo admin puede importar datos', 'err');
      return;
    }
    
    const coleccion = $('import-coleccion').value.trim();
    const fileInput = $('import-csv');
    
    if (!coleccion) {
      toast('⚠️ Ingrese un nombre para la colección', 'warn');
      return;
    }
    
    if (!fileInput.files || fileInput.files.length === 0) {
      toast('⚠️ Seleccione un archivo CSV o Excel', 'warn');
      return;
    }
    
    toast('⏳ Procesando archivo...', 'ok');
    
    // Leer archivo (CSV o Excel) y convertirlo a filas (array de arrays)
    const file = fileInput.files[0];
    const esExcel = /\.xlsx?$/i.test(file.name);
    let filas = [];

    if (esExcel) {
      if (!window.XLSX) {
        await new Promise((res, rej) => {
          const s = document.createElement('script');
          s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
          s.onload = res; s.onerror = rej; document.head.appendChild(s);
        });
      }
      const buffer = await file.arrayBuffer();
      const wb = XLSX.read(buffer, { type: 'array' });
      const primeraHoja = wb.Sheets[wb.SheetNames[0]];
      filas = XLSX.utils.sheet_to_json(primeraHoja, { header: 1, defval: '' })
        .map(fila => fila.map(celda => String(celda ?? '').trim()));
    } else {
      const text = await file.text();
      filas = text.split('\n').filter(l => l.trim())
        .map(linea => linea.split(',').map(p => p.replace(/^"|"$/g, '').trim()));
    }

    if (filas.length < 2) {
      toast('❌ El archivo está vacío o mal formateado', 'err');
      return;
    }
    
    // Detectar columnas por su encabezado, en vez de asumir una posición fija
    // (distintos archivos pueden traer GRADO/CÓDIGO en orden diferente)
    function buscarColumna(headerRow, nombresPosibles) {
      const normalizado = headerRow.map(h => String(h || '').toUpperCase().trim());
      for (const nombre of nombresPosibles) {
        const idx = normalizado.indexOf(nombre);
        if (idx !== -1) return idx;
      }
      return -1;
    }

    const encabezado = filas[0] || [];
    let iCodigo = buscarColumna(encabezado, ['CODIGO', 'CÓDIGO', 'N°', 'Nº', 'NUMERO']);
    let iGrado = buscarColumna(encabezado, ['GRADO']);
    let iApellidos = buscarColumna(encabezado, ['APELLIDOS']);
    let iNombres = buscarColumna(encabezado, ['NOMBRES']);
    let iArea = buscarColumna(encabezado, ['AREA ACTUAL', 'ÁREA ACTUAL', 'AREA', 'ÁREA']);

    // Si no se pudo detectar por encabezado, usar el orden por defecto conocido
    const usoPorDefecto = [iCodigo, iGrado, iApellidos, iNombres, iArea].some(i => i === -1);
    if (usoPorDefecto) {
      iCodigo = 0; iGrado = 1; iApellidos = 2; iNombres = 3; iArea = 4;
      toast('⚠️ No se detectaron los encabezados del archivo, se usó el orden por defecto (Código, Grado, Apellidos, Nombres, Área). Revise que los datos importados sean correctos.', 'err');
    }

    // Parsear filas (saltar encabezado)
    const resultado = $('import-resultado');
    show('import-resultado');
    resultado.style.display = 'block';
    resultado.innerHTML = '⏳ Procesando archivo...';

    const datos = {};
    const personalCompleto = []; // lista completa para autocompletar "Elaborado por" / "Responsable"
    const registrosPersonal = []; // para la colección plana 'personal' (visor paginado/editable)
    for (let i = 1; i < filas.length; i++) {
      const partes = filas[i];
      if (!partes || partes.length < 5 || !String(partes[iCodigo]).trim()) continue;
      
      const area = sanitizarNombreArea(partes[iArea] || 'SIN ÁREA');
      if (!datos[area]) datos[area] = [];
      
      const grado = partes[iGrado] || '';
      const apellidos = partes[iApellidos] || '';
      const nombres = partes[iNombres] || '';
      const nombreCompleto = `${apellidos} ${nombres}`.trim();
      const codigo = String(partes[iCodigo]).trim();

      datos[area].push({
        codigo: codigo,
        grado: grado,
        apellidosNombres: nombreCompleto,
        novedadesPorDia: {},
        observaciones: ''
      });

      personalCompleto.push(`${codigo} - ${grado} ${nombreCompleto}`.trim());
      registrosPersonal.push({ codigo, grado, apellidos, nombres, area });
    }
    
    // Guardar la lista completa de personal (para los selectores de "Elaborado por" / "Responsable")
    try {
      const personalRef = window._fb.doc(db, 'sistema', 'personal_lis');
      await window._fb.setDoc(personalRef, {
        lista: personalCompleto,
        ultimaActualizacion: new Date()
      });
    } catch(e) {
      console.warn('No se pudo guardar la lista de personal:', e);
    }

    // Guardar la lista real de áreas de Novedades encontradas (para el selector del admin
    // y el Resumen General — la lista fija AREAS es de Envíos y no coincide con el LIS)
    try {
      const areasRef = window._fb.doc(db, 'sistema', 'areas_novedades');
      const areasSnap = await window._fb.getDoc(areasRef);
      const areasPrevias = areasSnap.exists() ? (areasSnap.data().lista || []) : [];
      const areasNuevas = Object.keys(datos);
      const areasUnion = Array.from(new Set([...areasPrevias, ...areasNuevas])).sort();
      await window._fb.setDoc(areasRef, {
        lista: areasUnion,
        ultimaActualizacion: new Date()
      });
    } catch(e) {
      console.warn('No se pudo guardar la lista de áreas:', e);
    }

    // Guardar cada persona en la colección plana 'personal' (visor paginado/editable del admin)
    resultado.innerHTML = '⏳ Guardando el directorio de personal...';
    const tamanioLotePersonal = 100;
    let personalGuardados = 0;
    let personalErrorEjemplo = null;
    for (let i = 0; i < registrosPersonal.length; i += tamanioLotePersonal) {
      const lote = registrosPersonal.slice(i, i + tamanioLotePersonal);
      const resultados = await Promise.allSettled(lote.map(reg =>
        window._fb.setDoc(window._fb.doc(db, 'personal', reg.codigo), {
          ...reg,
          ultimaActualizacion: new Date()
        }, { merge: true })
      ));
      resultados.forEach(r => {
        if (r.status === 'fulfilled') personalGuardados++;
        else if (!personalErrorEjemplo) personalErrorEjemplo = r.reason;
      });
      resultado.innerHTML = `⏳ Guardando el directorio de personal... ${Math.min(i + tamanioLotePersonal, registrosPersonal.length)} / ${registrosPersonal.length}`;
    }
    if (personalErrorEjemplo) {
      console.error('Error guardando el directorio de personal:', personalErrorEjemplo);
      toast(`⚠️ Se guardaron ${personalGuardados}/${registrosPersonal.length} registros en la Base de Personal. Hubo errores — revise los permisos de Firestore para la colección "personal". Detalle: ${personalErrorEjemplo.message || personalErrorEjemplo}`, 'err');
    }
    
    // Guardar en Firestore — se FUSIONA con lo existente, nunca se sobrescribe
    // (si un agente rota de área a mitad de mes, sigue apareciendo en la anterior
    //  con lo ya registrado, y se agrega también a la nueva sin perder nada)
    const dateParts = obtenerFechaParts();
    const periodo = dateParts.periodo;

    const entradas = Object.entries(datos);
    const tamanioLote = 25;

    for (let i = 0; i < entradas.length; i += tamanioLote) {
      const lote = entradas.slice(i, i + tamanioLote);
      await Promise.all(lote.map(async ([area, agentesNuevos]) => {
        const novedadesRef = window._fb.doc(db, 'novedades', area, periodo, 'datos');
        const existente = await window._fb.getDoc(novedadesRef);
        const dataExistente = existente.exists() ? existente.data() : null;
        const agentesFinal = dataExistente ? [...(dataExistente.agentes || [])] : [];

        agentesNuevos.forEach(nuevo => {
          const codigoNuevoNorm = String(nuevo.codigo || '').replace(/\s+/g, '').toUpperCase();
          const yaExiste = codigoNuevoNorm && agentesFinal.some(a =>
            String(a.codigo || '').replace(/\s+/g, '').toUpperCase() === codigoNuevoNorm
          );
          if (!yaExiste) agentesFinal.push(nuevo);
        });

        await window._fb.setDoc(novedadesRef, {
          agentes: agentesFinal,
          estado: dataExistente ? dataExistente.estado : 'activo',
          diasBloqueados: dataExistente ? (dataExistente.diasBloqueados || []) : [],
          diasDesbloqueados: dataExistente ? (dataExistente.diasDesbloqueados || []) : [],
          diasNoCompletados: dataExistente ? dataExistente.diasNoCompletados : Array.from({length: 31}, (_, i) => i + 1),
          fechaCreacion: dataExistente ? dataExistente.fechaCreacion : new Date(),
          ultimaModificacion: new Date()
        });
      }));
      resultado.innerHTML = `⏳ Importando... ${Math.min(i + tamanioLote, entradas.length)} / ${entradas.length} áreas procesadas`;
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

    resultado.innerHTML = `
      ✅ <strong>Importación exitosa</strong><br>
      Colección: ${coleccion}<br>
      Áreas: ${Object.keys(datos).length}<br>
      Registros en Novedades: ${Object.values(datos).reduce((sum, arr) => sum + arr.length, 0)}<br>
      Registros en Base de Personal: ${personalGuardados} / ${registrosPersonal.length}${personalErrorEjemplo ? ' ⚠️ (hubo errores, ver arriba)' : ' ✅'}
    `;
    show('import-resultado');
    
    toast('✅ Base de datos importada', 'ok');
    
  } catch(e) {
    console.error('Error importando:', e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Corregir/Eliminar datos de un área+mes
═════════════════════════════════════════ */

/* ═════════════════════════════════════════
   PANEL ADMIN — Permisos (acceso parcial / supervisor)
═════════════════════════════════════════ */

function renderizarGruposPermisos() {
  const cont = $('permiso-acciones-grupos');
  if (cont.dataset.renderizado === '1') return;
  cont.innerHTML = PERMISOS_DISPONIBLES.map(grupo => `
    <div>
      <div style="font-size:12px;font-weight:700;color:var(--txt2);margin-bottom:6px;display:flex;align-items:center;justify-content:space-between;">
        <span>${grupo.tabLabel}</span>
        <a href="#" style="font-size:11px;font-weight:600;" onclick="event.preventDefault(); marcarGrupoPermiso('${grupo.tab}', true)">Marcar todo</a>
      </div>
      <div style="display:flex;flex-direction:column;gap:4px;padding-left:8px;">
        ${grupo.acciones.map(a => `
          <label style="display:flex;align-items:center;gap:8px;font-size:13px;">
            <input type="checkbox" value="${a.key}" data-grupo="${grupo.tab}" class="permiso-accion-check"> ${a.label}
          </label>
        `).join('')}
      </div>
    </div>
  `).join('');
  cont.dataset.renderizado = '1';
}

function marcarGrupoPermiso(tab, valor) {
  document.querySelectorAll(`.permiso-accion-check[data-grupo="${tab}"]`).forEach(c => c.checked = valor);
}

function actualizarVisibilidadTabsPermiso() {
  renderizarGruposPermisos();
}

function marcarSoloVerYExportar() {
  renderizarGruposPermisos();
  document.querySelectorAll('.permiso-accion-check').forEach(c => {
    c.checked = c.value.endsWith('_ver') || c.value.endsWith('_exportar');
  });
  toast('✅ Se marcaron solo las acciones de ver/exportar', 'ok');
}

async function guardarPermiso() {
  const correo = $('permiso-correo').value.trim().toLowerCase();
  const tipo = 'parcial';

  if (!correo || !correo.includes('@')) { toast('Ingrese un correo válido', 'err'); return; }

  try {
    const existente = await window._fb.getDoc(window._fb.doc(db, 'permisos_panel', correo));
    if (existente.exists()) {
      const continuar = await confirmarAccion(`El correo ${correo} ya tiene un permiso asignado.\n\n¿Quiere reemplazarlo por el nuevo que eligió?`, 'Permiso ya existente');
      if (!continuar) return;
    }
  } catch(e) { /* si falla la verificación, seguimos igual */ }

  const acciones = Array.from(document.querySelectorAll('.permiso-accion-check:checked')).map(c => c.value);

  if (acciones.length === 0) {
    toast('Marque al menos una acción', 'err');
    return;
  }

  try {
    await window._fb.setDoc(window._fb.doc(db, 'permisos_panel', correo), {
      correo, tipo, acciones,
      asignadoPor: usuario.email,
      fechaAsignacion: new Date()
    });

    const resumenAcciones = acciones
      .map(key => PERMISOS_DISPONIBLES.flatMap(g => g.acciones).find(a => a.key === key)?.label || key)
      .join(', ');

    await registrarEnAuditoria('asignar_permiso', null, correo, null, null, { tipo, acciones }, `Permiso "${tipo}" asignado a ${correo}${resumenAcciones ? ' — ' + resumenAcciones : ''}`);

    toast(`✅ Permiso asignado a ${correo}`, 'ok');
    $('permiso-correo').value = '';
    document.querySelectorAll('.permiso-accion-check').forEach(c => c.checked = false);
    poblarListaPermisos();
  } catch(e) {
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function poblarListaPermisos() {
  const cont = $('permisos-lista');
  cont.innerHTML = `<p class="td-vacio">Cargando...</p>`;

  try {
    const snap = await window._fb.getDocs(window._fb.collection(db, 'permisos_panel'));
    if (snap.empty) {
      cont.innerHTML = `<p class="td-vacio">Todavía no le asignaste acceso a nadie más</p>`;
      return;
    }

    const todasLasAcciones = PERMISOS_DISPONIBLES.flatMap(g => g.acciones);

    cont.innerHTML = snap.docs.map(d => {
      const data = d.data();
      const badge = data.tipo === 'supervisor'
        ? '<span style="background:var(--blue-l);color:var(--blue);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">SUPERVISOR (solo lectura)</span>'
        : '<span style="background:var(--green-l);color:var(--green);padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;">ACCESO PARCIAL</span>';
      const accionesTxt = (data.acciones || [])
        .map(key => todasLasAcciones.find(a => a.key === key)?.label || key)
        .join(' · ');
      return `
        <div style="display:flex;justify-content:space-between;align-items:flex-start;padding:12px;background:var(--bg);border-radius:8px;gap:12px;">
          <div>
            <div style="font-weight:600;">${data.correo} ${badge}</div>
            ${accionesTxt ? `<div style="font-size:11px;color:var(--txt2);margin-top:4px;">${accionesTxt}</div>` : ''}
          </div>
          <div style="display:flex;gap:6px;white-space:nowrap;">
            <button class="btn-acc btn-acc-blue" style="padding:4px 10px;font-size:11px;" onclick="editarPermiso('${d.id}')">✎ Editar</button>
            <button class="btn-acc btn-acc-red" style="padding:4px 10px;font-size:11px;" onclick="eliminarPermiso('${d.id}')">Quitar acceso</button>
          </div>
        </div>`;
    }).join('');
  } catch(e) {
    cont.innerHTML = `<p class="td-vacio">❌ Error cargando permisos: ${e.message}</p>`;
  }
}

async function editarPermiso(correo) {
  try {
    const snap = await window._fb.getDoc(window._fb.doc(db, 'permisos_panel', correo));
    if (!snap.exists()) { toast('No se encontró ese permiso', 'err'); return; }
    const data = snap.data();

    renderizarGruposPermisos();
    $('permiso-correo').value = data.correo;
    document.querySelectorAll('.permiso-accion-check').forEach(c => {
      c.checked = (data.acciones || []).includes(c.value);
    });

    $('permiso-correo').scrollIntoView({ behavior: 'smooth', block: 'center' });
    toast(`Editando permiso de ${correo} — ajuste las casillas y presione "Asignar permiso" para guardar`, 'ok');
  } catch(e) {
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function eliminarPermiso(correo) {
  if (!(await confirmarAccion(`¿Quitarle el acceso a ${correo}?`, 'Quitar acceso'))) return;
  try {
    await window._fb.deleteDoc(window._fb.doc(db, 'permisos_panel', correo));
    await registrarEnAuditoria('quitar_permiso', null, correo, null, null, {}, `Permiso quitado a ${correo}`);
    toast('✅ Acceso quitado', 'ok');
    poblarListaPermisos();
  } catch(e) {
    toast('❌ Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   VISTA REPORTES — actividad de solo lectura (supervisor)
═════════════════════════════════════════ */

let reporteActividadCache = [];
let paginaReporteActividad = 1;

function renderizarReporteActividadPagina() {
  const inicio = (paginaReporteActividad - 1) * POR_PAGINA_ENVIOS;
  const pagina = reporteActividadCache.slice(inicio, inicio + POR_PAGINA_ENVIOS);

  $('rep-actividad-lista').innerHTML = pagina.map(r => {
    const fecha = r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString('es-EC') : '—';
    return `
      <div style="padding:12px;background:var(--bg);border-radius:8px;border-left:3px solid var(--blue);">
        <div style="font-size:12px;font-weight:600;">${r.descripcion || r.accion}</div>
        <div style="font-size:11px;color:var(--txt2);margin-top:2px;">${r.admin || ''} · ${fecha}</div>
      </div>`;
  }).join('');

  renderizarControlesPaginacion('rep-actividad-paginacion', reporteActividadCache.length, paginaReporteActividad, 'cambiarPaginaReporteActividad');
}

function cambiarPaginaReporteActividad(delta) {
  const totalPaginas = Math.max(1, Math.ceil(reporteActividadCache.length / POR_PAGINA_ENVIOS));
  paginaReporteActividad = Math.min(totalPaginas, Math.max(1, paginaReporteActividad + delta));
  renderizarReporteActividadPagina();
}

async function cargarReportesActividad() {
  const lista = $('rep-actividad-lista');
  lista.innerHTML = `<p class="td-vacio">Cargando...</p>`;
  $('rep-total-acciones').textContent = '—';
  $('rep-total-novedades').textContent = '—';
  $('rep-ultima-actividad').textContent = '—';

  try {
    const hoy = obtenerFechaParts();
    const inicioMes = new Date(new Date().getFullYear(), new Date().getMonth(), 1);

    const snap = await window._fb.getDocs(
      window._fb.query(window._fb.collection(db, 'auditoria'), window._fb.orderBy('timestamp', 'desc'), window._fb.limit(200))
    );

    const registros = snap.docs.map(d => d.data());
    reporteActividadCache = registros;
    const esteMs = registros.filter(r => r.timestamp && r.timestamp.toDate && r.timestamp.toDate() >= inicioMes);
    const novedadesEsteMes = esteMs.filter(r => r.accion === 'modificar_novedad' || r.accion === 'modificar_novedad_mes_cerrado').length;

    $('rep-total-acciones').textContent = esteMs.length;
    $('rep-total-novedades').textContent = novedadesEsteMes;

    if (registros.length > 0 && registros[0].timestamp?.toDate) {
      $('rep-ultima-actividad').textContent = registros[0].timestamp.toDate().toLocaleString('es-EC');
    } else {
      $('rep-ultima-actividad').textContent = 'Sin registros';
    }

    if (registros.length === 0) {
      lista.innerHTML = `<p class="td-vacio">Todavía no hay actividad registrada</p>`;
      $('rep-actividad-paginacion').innerHTML = '';
      return;
    }

    paginaReporteActividad = 1;
    renderizarReporteActividadPagina();

  } catch(e) {
    console.error(e);
    lista.innerHTML = `<p class="td-vacio">❌ Error cargando la actividad: ${e.message}</p>`;
  }
}

async function exportarReporteActividadExcel() {
  if (!reporteActividadCache || reporteActividadCache.length === 0) {
    toast('No hay actividad para exportar todavía', 'err');
    return;
  }
  if (!window.ExcelJS) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const NAVY = 'FF1F3864';
  const BLANCO = 'FFFFFFFF';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Actividad del sistema');

  ws.columns = [
    { header: 'Fecha y hora', key: 'fecha', width: 20 },
    { header: 'Realizado por', key: 'admin', width: 26 },
    { header: 'Acción', key: 'accion', width: 24 },
    { header: 'Área', key: 'area', width: 22 },
    { header: 'Descripción', key: 'descripcion', width: 60 },
  ];

  ws.getRow(1).eachCell(c => {
    c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    c.font = { color: { argb: BLANCO }, bold: true };
  });

  reporteActividadCache.forEach(r => {
    ws.addRow({
      fecha: r.timestamp?.toDate ? r.timestamp.toDate().toLocaleString('es-EC') : '',
      admin: r.admin || '',
      accion: r.accion || '',
      area: r.area || '',
      descripcion: r.descripcion || ''
    });
  });

  const bordeDelgado = { style: 'thin', color: { argb: 'FF999999' } };
  ws.eachRow(row => row.eachCell(c => {
    c.border = { top: bordeDelgado, left: bordeDelgado, bottom: bordeDelgado, right: bordeDelgado };
  }));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `reporte_actividad_${new Date().toISOString().slice(0,10)}.xlsx`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);

  toast('✅ Reporte descargado', 'ok');
}

async function poblarSelectoresLimpieza() {
  const selArea = $('limpiar-area');
  const selMes = $('limpiar-mes');
  const selAnio = $('limpiar-anio');
  if (!selArea || !selMes || !selAnio) return;

  const areasReales = await obtenerAreasNovedades();
  selArea.innerHTML = areasReales.map(a => `<option value="${a}">${a}</option>`).join('');

  if (selMes.options.length === 0) {
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = m;
      selMes.appendChild(opt);
    });
  }
  if (selAnio.options.length === 0) {
    const anioActual = new Date().getFullYear();
    for (let a = anioActual - 1; a <= anioActual + 1; a++) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      selAnio.appendChild(opt);
    }
  }
  const hoy = obtenerFechaParts();
  selMes.value = hoy.mes;
  selAnio.value = String(new Date().getFullYear());
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Base de Personal (visor paginado/editable)
═════════════════════════════════════════ */

let personalDirectorioCache = [];
let personalPaginaActual = 1;
const PERSONAL_POR_PAGINA = 20;

async function cargarDirectorioPersonal() {
  const cargando = $('personal-cargando');
  const cont = $('personal-tabla-container');
  hide('personal-paginacion');
  show('personal-cargando');
  cargando.style.display = 'block';
  hide('personal-tabla-container');

  try {
    const snap = await window._fb.getDocs(window._fb.collection(db, 'personal'));
    personalDirectorioCache = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    personalPaginaActual = 1;
    hide('personal-cargando');
    show('personal-tabla-container');
    cont.style.display = 'block';
    renderizarTablaPersonal();
  } catch(e) {
    console.error(e);
    cargando.textContent = '❌ Error cargando el directorio: ' + e.message;
  }
}

function obtenerPersonalFiltrado() {
  const fCodigo = ($('personal-filtro-codigo')?.value || '').toLowerCase().trim();
  const fGrado = ($('personal-filtro-grado')?.value || '').toLowerCase().trim();
  const fNombre = ($('personal-filtro-nombre')?.value || '').toLowerCase().trim();
  const fArea = ($('personal-filtro-area')?.value || '').toLowerCase().trim();

  return personalDirectorioCache.filter(p => {
    if (fCodigo && !String(p.codigo || '').toLowerCase().includes(fCodigo)) return false;
    if (fGrado && !String(p.grado || '').toLowerCase().includes(fGrado)) return false;
    if (fNombre && !`${p.apellidos || ''} ${p.nombres || ''}`.toLowerCase().includes(fNombre)) return false;
    if (fArea && !String(p.area || '').toLowerCase().includes(fArea)) return false;
    return true;
  });
}

function filtrarPersonal() {
  personalPaginaActual = 1;
  renderizarTablaPersonal();
}

function cambiarPaginaPersonal(delta) {
  const filtrados = obtenerPersonalFiltrado();
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PERSONAL_POR_PAGINA));
  personalPaginaActual = Math.min(totalPaginas, Math.max(1, personalPaginaActual + delta));
  renderizarTablaPersonal();
}

let personalSeleccionados = new Set(); // ids seleccionados para el cambio de área en lote

function renderizarTablaPersonal() {
  const filtrados = obtenerPersonalFiltrado();
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PERSONAL_POR_PAGINA));
  personalPaginaActual = Math.min(personalPaginaActual, totalPaginas);

  const inicio = (personalPaginaActual - 1) * PERSONAL_POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + PERSONAL_POR_PAGINA);

  const tbody = $('personal-tabla-body');
  if (pagina.length === 0) {
    tbody.innerHTML = `<tr><td colspan="9" class="td-vacio">No se encontraron registros</td></tr>`;
  } else {
    tbody.innerHTML = pagina.map(p => `
      <tr>
        <td><input type="checkbox" data-personal-id="${p.id}" ${personalSeleccionados.has(p.id) ? 'checked' : ''} onchange="toggleSeleccionPersonal('${p.id}', this.checked)"></td>
        <td>${p.codigo || ''}</td>
        <td>${p.grado || ''}</td>
        <td>${p.apellidos || ''}</td>
        <td>${p.nombres || ''}</td>
        <td>${p.area || ''}</td>
        <td>${p.areaTemporal || '<span style="color:var(--txt3)">—</span>'}</td>
        <td>${p.areaTemporal ? '<span style="background:var(--gold-l);color:var(--gold);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">R</span>' : ''}</td>
        <td style="white-space:nowrap;">
${tienePermisoAccion('importar_editar_personal') ? `
          <button class="btn-acc btn-acc-blue" style="padding:4px 8px;font-size:11px;" onclick="editarRegistroPersonal('${p.id}')">✎</button>
          <button class="btn-acc btn-acc-red" style="padding:4px 8px;font-size:11px;" onclick="eliminarRegistroPersonal('${p.id}')">🗑️</button>` : ''}
        </td>
      </tr>
    `).join('');
  }

  show('personal-paginacion');
  $('personal-paginacion').style.display = 'flex';
  $('personal-paginacion-info').textContent =
    `${filtrados.length} registro${filtrados.length !== 1 ? 's' : ''} — página ${personalPaginaActual} de ${totalPaginas}`;

  // Botón para seleccionar TODOS los filtrados (no solo los de la página actual)
  const btnFiltrados = $('personal-seleccionar-filtrados');
  const hayFiltroActivo = ['personal-filtro-codigo','personal-filtro-grado','personal-filtro-nombre','personal-filtro-area']
    .some(id => ($(id)?.value || '').trim() !== '');
  if (filtrados.length > 0 && (hayFiltroActivo || filtrados.length > PERSONAL_POR_PAGINA)) {
    btnFiltrados.style.display = 'inline-flex';
    btnFiltrados.textContent = `☑️ Seleccionar los ${filtrados.length} registros filtrados (todas las páginas)`;
  } else {
    btnFiltrados.style.display = 'none';
  }

  actualizarBarraCambioLote();
}

function toggleSeleccionPersonal(id, checked) {
  if (checked) personalSeleccionados.add(id);
  else personalSeleccionados.delete(id);
  actualizarBarraCambioLote();
}

function toggleSeleccionarTodosPersonal(checked) {
  const filtrados = obtenerPersonalFiltrado();
  const totalPaginas = Math.max(1, Math.ceil(filtrados.length / PERSONAL_POR_PAGINA));
  const inicio = (personalPaginaActual - 1) * PERSONAL_POR_PAGINA;
  const pagina = filtrados.slice(inicio, inicio + PERSONAL_POR_PAGINA);
  pagina.forEach(p => { if (checked) personalSeleccionados.add(p.id); else personalSeleccionados.delete(p.id); });
  renderizarTablaPersonal();
}

function seleccionarTodosLosFiltradosPersonal() {
  const filtrados = obtenerPersonalFiltrado();
  filtrados.forEach(p => personalSeleccionados.add(p.id));
  renderizarTablaPersonal();
  toast(`✅ ${filtrados.length} registros seleccionados`, 'ok');
}

function limpiarSeleccionPersonal() {
  personalSeleccionados.clear();
  renderizarTablaPersonal();
}

function actualizarBarraCambioLote() {
  const barra = $('personal-cambio-lote');
  if (personalSeleccionados.size === 0) {
    barra.style.display = 'none';
    return;
  }
  barra.style.display = 'flex';
  $('personal-cambio-lote-info').textContent = `${personalSeleccionados.size} agente${personalSeleccionados.size !== 1 ? 's' : ''} seleccionado${personalSeleccionados.size !== 1 ? 's' : ''}`;

  const sel = $('personal-cambio-lote-area');
  if (sel.dataset.poblado !== '1') {
    obtenerAreasNovedades().then(areas => {
      sel.innerHTML = areas.map(a => `<option value="${a}">${a}</option>`).join('');
      sel.dataset.poblado = '1';
    });
  }
}

async function aplicarCambioAreaLote() {
  const nuevaArea = $('personal-cambio-lote-area').value;
  if (!nuevaArea) { toast('Elegí un área', 'err'); return; }
  if (personalSeleccionados.size === 0) return;

  if (!(await confirmarAccion(`¿Cambiar el área de ${personalSeleccionados.size} agente(s) a "${nuevaArea}"?`, 'Cambiar área en lote'))) return;

  try {
    const ids = Array.from(personalSeleccionados);
    const tamanioLote = 50;
    for (let i = 0; i < ids.length; i += tamanioLote) {
      const lote = ids.slice(i, i + tamanioLote);
      await Promise.all(lote.map(id =>
        window._fb.setDoc(window._fb.doc(db, 'personal', id), {
          area: nuevaArea,
          ultimaActualizacion: new Date()
        }, { merge: true })
      ));
    }

    await registrarEnAuditoria(
      'cambio_area_lote', nuevaArea, usuario.email, null, null,
      { cantidad: ids.length },
      `Cambio de área en lote: ${ids.length} agentes → ${nuevaArea}`
    );

    toast(`✅ ${ids.length} agentes actualizados a "${nuevaArea}"`, 'ok');
    limpiarSeleccionPersonal();
    cargarDirectorioPersonal();
  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

let modalPersonalIdEdicion = null;

async function poblarSelectAreaTemporal() {
  const sel = $('modal-personal-area-temporal');
  if (sel.dataset.poblado === '1') return;
  const areasReales = await obtenerAreasNovedades();
  sel.innerHTML = '<option value="">— No aplica —</option>' + areasReales.map(a => `<option value="${a}">${a}</option>`).join('');
  sel.dataset.poblado = '1';
}

async function abrirModalPersonal() {
  modalPersonalIdEdicion = null;
  await poblarSelectAreaTemporal();
  $('modal-personal-titulo').textContent = 'Agregar registro';
  $('modal-personal-codigo').value = '';
  $('modal-personal-codigo').disabled = false;
  $('modal-personal-grado').value = '';
  $('modal-personal-apellidos').value = '';
  $('modal-personal-nombres').value = '';
  $('modal-personal-area').value = '';
  $('modal-personal-area-temporal').value = '';
  hide('modal-personal-error');
  $('modal-personal').style.display = 'flex';
}

async function editarRegistroPersonal(id) {
  const p = personalDirectorioCache.find(x => x.id === id);
  if (!p) return;
  modalPersonalIdEdicion = id;
  await poblarSelectAreaTemporal();
  $('modal-personal-titulo').textContent = 'Editar registro';
  $('modal-personal-codigo').value = p.codigo || '';
  $('modal-personal-codigo').disabled = true; // el código es el ID del documento
  $('modal-personal-grado').value = p.grado || '';
  $('modal-personal-apellidos').value = p.apellidos || '';
  $('modal-personal-nombres').value = p.nombres || '';
  $('modal-personal-area').value = p.area || '';
  $('modal-personal-area-temporal').value = p.areaTemporal || '';
  hide('modal-personal-error');
  $('modal-personal').style.display = 'flex';
}

function cerrarModalPersonal() {
  $('modal-personal').style.display = 'none';
  modalPersonalIdEdicion = null;
}

async function guardarRegistroPersonal() {
  const codigo = $('modal-personal-codigo').value.trim();
  const grado = $('modal-personal-grado').value.trim();
  const apellidos = $('modal-personal-apellidos').value.trim();
  const nombres = $('modal-personal-nombres').value.trim();
  const area = $('modal-personal-area').value.trim();
  const areaTemporal = $('modal-personal-area-temporal').value.trim();
  const errorEl = $('modal-personal-error');

  if (!codigo) { errorEl.textContent = 'El código es obligatorio'; show('modal-personal-error'); return; }
  if (!area) { errorEl.textContent = 'El área es obligatoria'; show('modal-personal-error'); return; }

  try {
    const areaSanitizada = sanitizarNombreArea(area);
    await window._fb.setDoc(window._fb.doc(db, 'personal', codigo), {
      codigo, grado, apellidos, nombres, area: areaSanitizada,
      areaTemporal: areaTemporal || null,
      estadoTemporal: areaTemporal ? 'R' : null,
      ultimaActualizacion: new Date()
    }, { merge: true });

    // Mantener sincronizada la lista de áreas conocidas
    const areasRef = window._fb.doc(db, 'sistema', 'areas_novedades');
    const areasSnap = await window._fb.getDoc(areasRef);
    const areasPrevias = areasSnap.exists() ? (areasSnap.data().lista || []) : [];
    if (!areasPrevias.includes(areaSanitizada)) {
      await window._fb.setDoc(areasRef, {
        lista: [...areasPrevias, areaSanitizada].sort(),
        ultimaActualizacion: new Date()
      });
    }

    await registrarEnAuditoria(
      modalPersonalIdEdicion ? 'editar_personal' : 'crear_personal',
      areaSanitizada, usuario.email, null, null, { codigo, areaTemporal },
      `${modalPersonalIdEdicion ? 'Editado' : 'Agregado'} registro de personal: ${codigo} — ${apellidos} ${nombres}${areaTemporal ? ` (reemplazo temporal en ${areaTemporal})` : ''}`
    );

    toast(`✅ Registro ${modalPersonalIdEdicion ? 'actualizado' : 'agregado'}`, 'ok');
    cerrarModalPersonal();
    cargarDirectorioPersonal();
  } catch(e) {
    errorEl.textContent = 'Error: ' + e.message;
    show('modal-personal-error');
  }
}

async function eliminarRegistroPersonal(id) {
  const p = personalDirectorioCache.find(x => x.id === id);
  if (!p) return;
  if (!(await confirmarAccion(`¿Eliminar el registro de "${p.apellidos} ${p.nombres}" (código ${p.codigo})?\n\nEsto NO borra sus novedades ya cargadas en meses anteriores, solo lo saca del directorio de personal.`, 'Eliminar registro de personal'))) return;

  try {
    await window._fb.deleteDoc(window._fb.doc(db, 'personal', id));
    await registrarEnAuditoria('eliminar_personal', p.area, usuario.email, null, null, { codigo: p.codigo }, `Registro de personal eliminado: ${p.codigo} — ${p.apellidos} ${p.nombres}`);
    toast('✅ Registro eliminado', 'ok');
    cargarDirectorioPersonal();
  } catch(e) {
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function eliminarNovedadesAreaMes() {
  const area = $('limpiar-area').value;
  const mes = $('limpiar-mes').value;
  const anio = $('limpiar-anio').value;
  if (!area || !mes || !anio) { toast('Elija área, mes y año', 'err'); return; }
  const periodo = `${anio}-${mes}`;

  const confirmado = await confirmarConTexto(
    `Esto va a BORRAR PERMANENTEMENTE todas las novedades de:\n\n` +
    `Área: ${area}\nMes: ${periodo}\n\n` +
    `Esta acción no se puede deshacer. Escriba BORRAR para confirmar:`,
    'BORRAR',
    'Eliminar Novedades de un área/mes'
  );
  if (!confirmado) {
    toast('Cancelado — no se borró nada', 'ok');
    return;
  }

  try {
    const ref = window._fb.doc(db, 'novedades', area, periodo, 'datos');
    const snap = await window._fb.getDoc(ref);
    if (!snap.exists()) {
      toast('No había datos guardados para esa área/mes', 'ok');
      return;
    }
    const cantidadAgentes = (snap.data().agentes || []).length;

    await window._fb.deleteDoc(ref);

    await registrarEnAuditoria(
      'eliminar_novedades_area_mes', area, usuario.email, null, periodo,
      { cantidadAgentes },
      `Eliminación manual: ${area} — ${periodo} (${cantidadAgentes} agentes)`
    );

    toast(`✅ Se eliminaron los datos de ${area} — ${periodo}`, 'ok');

    // Si era el área/mes que estaba viendo en pantalla, recargar
    if (areaActual === area && mesActual === periodo) cargarNovedadesActuales();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

async function borrarTodaLaBaseNovedades() {
  if (!esAdmin()) {
    toast('❌ Solo el administrador puede hacer esto', 'err');
    return;
  }

  const primeraConfirmacion = await confirmarAccion(
    '⚠️ ESTO VA A BORRAR TODA LA BASE DE NOVEDADES (todas las áreas, todos los meses).\n\n' +
    'Los envíos de archivos (pestaña Envíos) no se tocan.\n\n' +
    '¿Está seguro de que quiere continuar?',
    'Borrar toda la base de Novedades'
  );
  if (!primeraConfirmacion) { toast('Cancelado', 'ok'); return; }

  const segundaConfirmacion = await confirmarConTexto(
    'Para confirmar, escriba exactamente: BORRAR TODO',
    'BORRAR TODO',
    'Confirmación final'
  );
  if (!segundaConfirmacion) {
    toast('Cancelado — no se borró nada', 'ok');
    return;
  }

  const progreso = $('borrar-todo-progreso');
  show('borrar-todo-progreso');
  progreso.style.display = 'block';
  progreso.textContent = 'Preparando...';

  try {
    const areasReales = await obtenerAreasNovedades();

    // Rango de meses a cubrir: desde el año pasado hasta el año que viene
    const anioActual = new Date().getFullYear();
    const periodos = [];
    for (let a = anioActual - 1; a <= anioActual + 1; a++) {
      for (let m = 1; m <= 12; m++) {
        periodos.push(`${a}-${String(m).padStart(2, '0')}`);
      }
    }

    const combinaciones = [];
    areasReales.forEach(area => {
      periodos.forEach(periodo => combinaciones.push({ area, periodo }));
    });

    let borrados = 0;
    const tamanioLote = 25;
    for (let i = 0; i < combinaciones.length; i += tamanioLote) {
      const lote = combinaciones.slice(i, i + tamanioLote);
      await Promise.all(lote.map(async ({ area, periodo }) => {
        try {
          await window._fb.deleteDoc(window._fb.doc(db, 'novedades', area, periodo, 'datos'));
        } catch(e) { /* documento no existía, se ignora */ }
      }));
      borrados += lote.length;
      progreso.textContent = `Borrando... ${Math.min(borrados, combinaciones.length)} / ${combinaciones.length} combinaciones revisadas`;
    }

    // Resetear las listas de áreas y personal para que la próxima importación arranque limpia
    await window._fb.deleteDoc(window._fb.doc(db, 'sistema', 'areas_novedades')).catch(() => {});
    await window._fb.deleteDoc(window._fb.doc(db, 'sistema', 'personal_lis')).catch(() => {});

    await registrarEnAuditoria(
      'borrar_toda_base_novedades', null, usuario.email, null, null,
      { areasRevisadas: areasReales.length, periodosRevisados: periodos.length },
      `Borrado total de la base de Novedades por ${usuario.email}`
    );

    progreso.textContent = `✅ Listo. Se revisaron ${areasReales.length} áreas × ${periodos.length} meses.`;
    toast('✅ Base de Novedades borrada. Puede volver a importar desde cero.', 'ok');

    novedadesActuales = null;
    areaActual = null;

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
    progreso.textContent = '❌ Ocurrió un error, revise la consola.';
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
        ${tienePermisoAccion('accesos_gestionar') ? `
        <button class="btn-acc btn-acc-blue" onclick="editarAcceso('${doc.id}', '${data.correo.replace(/'/g,"\\'")}', '${data.area.replace(/'/g,"\\'")}')">✎</button>
        <button class="btn-acc btn-acc-red" onclick="eliminarAcceso('${doc.id}')">🗑</button>` : ''}
      `;
      lista.appendChild(div);
    });
    
  } catch(e) {
    console.error('Error cargando accesos:', e);
    toast('Error: ' + e.message, 'err');
  }
}

let modalAccesoDocIdEdicion = null; // null = creando nuevo, string = editando existente

async function poblarSelectAreaAcceso() {
  const sel = $('modal-acceso-area');
  if (sel.dataset.poblado !== '1') {
    const areasReales = await obtenerAreasNovedades();
    sel.innerHTML = areasReales.map(a => `<option value="${a}">${a}</option>`).join('');
    sel.dataset.poblado = '1';
  }
}

async function mostrarFormAcceso() {
  modalAccesoDocIdEdicion = null;
  await poblarSelectAreaAcceso();
  $('modal-acceso-titulo').textContent = 'Nuevo Acceso';
  $('modal-acceso-sub').textContent = 'Asigná un área a este correo';
  $('modal-acceso-correo').value = '';
  $('modal-acceso-correo').disabled = false;
  $('modal-acceso').style.display = 'flex';
  hide('modal-acceso-error');
  $('modal-acceso-correo').focus();
}

async function editarAcceso(docId, correoActual, areaAsignada) {
  modalAccesoDocIdEdicion = docId;
  await poblarSelectAreaAcceso();
  $('modal-acceso-titulo').textContent = 'Editar Acceso';
  $('modal-acceso-sub').textContent = 'Cambie el área asignada a este correo';
  $('modal-acceso-correo').value = correoActual || docId;
  $('modal-acceso-correo').disabled = true; // el correo es el ID del documento, no se cambia acá
  if (areaAsignada) $('modal-acceso-area').value = areaAsignada;
  hide('modal-acceso-error');
  $('modal-acceso').style.display = 'flex';
}

function cerrarModalAcceso() {
  $('modal-acceso').style.display = 'none';
  modalAccesoDocIdEdicion = null;
}

async function confirmarGuardarAcceso() {
  const correo = $('modal-acceso-correo').value.trim();
  const area = $('modal-acceso-area').value;
  const errorEl = $('modal-acceso-error');

  if (!correo || !correo.includes('@')) {
    errorEl.textContent = 'Ingresá un correo válido';
    show('modal-acceso-error');
    return;
  }
  if (!area) {
    errorEl.textContent = 'Elegí un área';
    show('modal-acceso-error');
    return;
  }

  await guardarAcceso(correo, area);
  cerrarModalAcceso();
}

async function guardarAcceso(correo, area) {
  try {
    const correoNorm = correo.toLowerCase().trim();
    // Un solo registro por correo (usando el correo como ID) — si la persona ya tenía
    // acceso y rota de área, esto ACTUALIZA su área en vez de crear un duplicado.
    const accesoRef = window._fb.doc(db, 'accesos', correoNorm);
    const existente = await window._fb.getDoc(accesoRef);

    await window._fb.setDoc(accesoRef, {
      correo: correoNorm,
      area: area,
      estado: true,
      fechaCreacion: existente.exists() ? existente.data().fechaCreacion : new Date(),
      ultimaEdicion: new Date()
    });

    await registrarEnAuditoria(
      existente.exists() ? 'editar_acceso' : 'crear_acceso',
      area, correoNorm, null, null, {},
      existente.exists()
        ? `Área actualizada: ${correoNorm} → ${area} (antes: ${existente.data().area})`
        : `Nuevo acceso: ${correoNorm} → ${area}`
    );
    
    toast(`✅ Acceso ${existente.exists() ? 'actualizado' : 'creado'}`, 'ok');
    cargarAccesos();
    
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

async function eliminarAcceso(docId) {
  if (!(await confirmarAccion('¿Eliminar este acceso?', 'Eliminar acceso'))) return;
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

let auditoriaCache = [];
let paginaAuditoria = 1;

async function cargarAuditoria() {
  try {
    const auditSnapshot = await window._fb.getDocs(
      window._fb.query(window._fb.collection(db, 'auditoria'), window._fb.orderBy('timestamp', 'desc'))
    );

    auditoriaCache = auditSnapshot.docs.map(doc => doc.data());
    paginaAuditoria = 1;

    if (auditoriaCache.length === 0) {
      show('auditoria-vacio');
      $('auditoria-body').innerHTML = '';
      $('auditoria-paginacion').innerHTML = '';
      return;
    }

    hide('auditoria-vacio');
    renderizarAuditoriaPagina();

  } catch(e) {
    console.error('Error:', e);
    toast('Error cargando auditoría: ' + e.message, 'err');
  }
}

function renderizarAuditoriaPagina() {
  const inicio = (paginaAuditoria - 1) * POR_PAGINA_ENVIOS;
  const pagina = auditoriaCache.slice(inicio, inicio + POR_PAGINA_ENVIOS);
  const tbody = $('auditoria-body');

  tbody.innerHTML = pagina.map(data => {
    const fecha = data.timestamp ? (data.timestamp.toDate ? data.timestamp.toDate().toLocaleString() : new Date(data.timestamp).toLocaleString()) : '';
    return `
      <tr>
        <td style="font-size:10px;">${fecha}</td>
        <td style="font-size:10px;">${data.admin || '—'}</td>
        <td style="font-size:10px;">${data.accion || '—'}</td>
        <td style="font-size:10px;">${data.descripcion || '—'}</td>
      </tr>`;
  }).join('');

  renderizarControlesPaginacion('auditoria-paginacion', auditoriaCache.length, paginaAuditoria, 'cambiarPaginaAuditoria');
}

function cambiarPaginaAuditoria(delta) {
  const totalPaginas = Math.max(1, Math.ceil(auditoriaCache.length / POR_PAGINA_ENVIOS));
  paginaAuditoria = Math.min(totalPaginas, Math.max(1, paginaAuditoria + delta));
  renderizarAuditoriaPagina();
}

async function filtrarAuditoria() {
  toast('⏳ Filtrado en desarrollo...', 'ok');
  // Implementar filtros más adelante
}

async function limpiarAuditoria() {
  if (!(await confirmarAccion('¿Eliminar TODO el historial de auditoría? Esta acción no se puede deshacer.', 'Limpiar auditoría'))) return;
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

async function poblarSelectoresDesbloqueoDirecto() {
  const selArea = $('desbloqueo-directo-area');
  const selMes = $('desbloqueo-directo-mes');
  const selAnio = $('desbloqueo-directo-anio');
  const selDia = $('desbloqueo-directo-dia');
  if (!selArea || !selMes || !selAnio || !selDia) return;

  const areasReales = await obtenerAreasNovedades();
  selArea.innerHTML = areasReales.map(a => `<option value="${a}">${a}</option>`).join('');

  if (selMes.options.length === 0) {
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = m;
      selMes.appendChild(opt);
    });
  }
  if (selAnio.options.length === 0) {
    const anioActual = new Date().getFullYear();
    for (let a = anioActual - 1; a <= anioActual + 1; a++) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      selAnio.appendChild(opt);
    }
  }
  if (selDia.options.length === 0) {
    for (let d = 1; d <= 31; d++) {
      const opt = document.createElement('option');
      opt.value = String(d);
      opt.textContent = String(d);
      selDia.appendChild(opt);
    }
  }

  const hoy = obtenerFechaParts();
  selMes.value = hoy.mes;
  selAnio.value = String(new Date().getFullYear());
  selDia.value = String(hoy.dia);
}

async function desbloquearDiaDirecto() {
  const area = $('desbloqueo-directo-area').value;
  const mes = $('desbloqueo-directo-mes').value;
  const anio = $('desbloqueo-directo-anio').value;
  const dia = parseInt($('desbloqueo-directo-dia').value, 10);
  if (!area || !mes || !anio || !dia) { toast('Complete todos los campos', 'err'); return; }

  const periodo = `${anio}-${mes}`;

  try {
    const ref = window._fb.doc(db, 'novedades', area, periodo, 'datos');
    const snap = await window._fb.getDoc(ref);
    if (!snap.exists()) {
      toast(`No hay datos de Novedades para ${area} — ${periodo}`, 'err');
      return;
    }
    const data = snap.data();
    const diasDesbloqueados = data.diasDesbloqueados || [];
    if (!diasDesbloqueados.includes(dia)) diasDesbloqueados.push(dia);

    await window._fb.updateDoc(ref, { diasDesbloqueados });

    await registrarEnAuditoria(
      'desbloqueo_directo', area, usuario.email, dia, periodo, {},
      `Desbloqueo directo (sin solicitud): ${area} — día ${dia} de ${periodo}, autorizado por ${usuario.email}`
    );

    toast(`✅ Día ${dia} de ${periodo} desbloqueado para ${area}. Se vuelve a bloquear solo apenas guarden el cambio.`, 'ok');

    // Si es el área/mes que se está viendo, refrescar
    if (areaActual === area) cargarNovedadesActuales();

  } catch(e) {
    console.error(e);
    toast('❌ Error: ' + e.message, 'err');
  }
}

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
            <div style="font-size:11px;color:var(--txt2);">${data.area} — ${data.tipo === 'desbloqueo_dia' ? 'Día ' + data.dia : (data.tipo === 'desbloqueo_multiples_dias' ? 'Días ' + (data.dias || []).join(', ') : 'Mes ' + data.mes)}</div>
            ${data.razon ? `<div style="font-size:11px;color:var(--txt3);margin-top:2px;">"${data.razon}"</div>` : ''}
          </div>
          ${data.estado === 'pendiente' && tienePermisoAccion('desbloqueos_aprobar') ? `
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
    const solRef = window._fb.doc(db, 'solicitudes', docId);
    const solDoc = await window._fb.getDoc(solRef);
    if (!solDoc.exists()) { toast('❌ Solicitud no encontrada', 'err'); return; }
    const sol = solDoc.data();

    await window._fb.updateDoc(solRef, {
      estado: 'aprobada',
      fechaRespuesta: new Date()
    });

    // Soporta solicitudes de un solo día (campo "dia") o de varios días (campo "dias")
    const diasAAprobar = Array.isArray(sol.dias) ? sol.dias : (sol.dia ? [sol.dia] : []);

    // Habilitar la edición de esos días en el documento de Novedades del área/mes correspondiente
    if (sol.area && sol.mes && diasAAprobar.length) {
      const novedadesRef = window._fb.doc(db, 'novedades', sol.area, sol.mes, 'datos');
      const novedadesDoc = await window._fb.getDoc(novedadesRef);
      if (novedadesDoc.exists()) {
        const data = novedadesDoc.data();
        const diasDesbloqueados = data.diasDesbloqueados || [];
        diasAAprobar.forEach(d => {
          if (!diasDesbloqueados.includes(d)) diasDesbloqueados.push(d);
        });
        await window._fb.updateDoc(novedadesRef, { diasDesbloqueados });
      }
      await registrarEnAuditoria(
        'aprobar_desbloqueo', sol.area, sol.correoUsuario,
        diasAAprobar.length === 1 ? diasAAprobar[0] : null, sol.mes,
        { dias: diasAAprobar },
        `Día(s) ${diasAAprobar.join(', ')} desbloqueado(s) para ${sol.correoUsuario}`
      );
    }

    toast(
      diasAAprobar.length === 1
        ? '✅ Desbloqueo aprobado — el día ya se puede editar'
        : `✅ Desbloqueo aprobado — ${diasAAprobar.length} días ya se pueden editar`,
      'ok'
    );
    cargarDesbloqueos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

let rechazoDesbloqueoDocId = null;

function rechazarDesbloqueo(docId) {
  rechazoDesbloqueoDocId = docId;
  $('rechazo-desbloqueo-razon').value = '';
  $('modal-rechazar-desbloqueo').style.display = 'flex';
  $('rechazo-desbloqueo-razon').focus();
}

function cerrarModalRechazarDesbloqueo() {
  $('modal-rechazar-desbloqueo').style.display = 'none';
  rechazoDesbloqueoDocId = null;
}

async function confirmarRechazarDesbloqueo() {
  const razon = $('rechazo-desbloqueo-razon').value.trim();
  if (!razon) { toast('Escriba el motivo del rechazo', 'err'); return; }
  const docId = rechazoDesbloqueoDocId;
  if (!docId) return;

  try {
    await window._fb.updateDoc(window._fb.doc(db, 'solicitudes', docId), {
      estado: 'rechazada',
      fechaRespuesta: new Date(),
      respuestaAdmin: razon
    });
    toast('❌ Desbloqueo rechazado', 'ok');
    cerrarModalRechazarDesbloqueo();
    cargarDesbloqueos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Resumen General de Novedades
═════════════════════════════════════════ */

function poblarSelectoresResumen(prefix = 'resumen') {
  const selMes = $(`${prefix}-mes`);
  const selAnio = $(`${prefix}-anio`);
  if (!selMes || !selAnio) return;

  if (selMes.options.length === 0) {
    const meses = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    meses.forEach((m, i) => {
      const opt = document.createElement('option');
      opt.value = String(i + 1).padStart(2, '0');
      opt.textContent = m;
      selMes.appendChild(opt);
    });
  }
  if (selAnio.options.length === 0) {
    const anioActual = new Date().getFullYear();
    for (let a = anioActual - 1; a <= anioActual + 1; a++) {
      const opt = document.createElement('option');
      opt.value = String(a);
      opt.textContent = String(a);
      selAnio.appendChild(opt);
    }
  }

  const hoy = obtenerFechaParts();
  selMes.value = hoy.mes;
  selAnio.value = String(new Date().getFullYear());
}

async function cargarResumenGeneral(prefix = 'resumen') {
  const mes = $(`${prefix}-mes`).value;
  const anio = $(`${prefix}-anio`).value;
  if (!mes || !anio) { toast('Elija mes y año', 'err'); return; }
  const periodo = `${anio}-${mes}`;

  const tbody = $(`${prefix}-tabla-body`);
  tbody.innerHTML = `<tr><td colspan="12" class="td-vacio">Cargando...</td></tr>`;
  const detalleCont = $(`${prefix}-detalle-container`);
  if (detalleCont) hide(`${prefix}-detalle-container`);

  const filasPorArea = [];
  const totales = { total: 0, 'S/N':0, 'OA':0, 'X':0, 'CS':0, 'B':0, 'Li':0, 'V':0, 'PE':0 };
  const detalleAusenciasX = [];

  // Reemplazos temporales (R) por área — se cuentan desde la Base de Personal
  const reemplazosPorArea = {};
  try {
    const personalSnap = await window._fb.getDocs(window._fb.collection(db, 'personal'));
    personalSnap.docs.forEach(d => {
      const p = d.data();
      if (p.areaTemporal) reemplazosPorArea[p.areaTemporal] = (reemplazosPorArea[p.areaTemporal] || 0) + 1;
    });
  } catch(e) {
    console.warn('No se pudo cargar el conteo de reemplazos temporales:', e);
  }

  const areasReales = await obtenerAreasNovedades();
  const tbodyProgreso = tbody;
  const tamanioLoteResumen = 25;

  for (let i = 0; i < areasReales.length; i += tamanioLoteResumen) {
    const lote = areasReales.slice(i, i + tamanioLoteResumen);
    await Promise.all(lote.map(async (area) => {
      try {
        const ref = window._fb.doc(db, 'novedades', area, periodo, 'datos');
        const snap = await window._fb.getDoc(ref);
        if (!snap.exists()) return;
        const data = snap.data();
        const agentes = data.agentes || [];
        if (agentes.length === 0) return;

        const conteo = { 'S/N':0, 'OA':0, 'X':0, 'CS':0, 'B':0, 'Li':0, 'V':0, 'PE':0 };
        agentes.forEach(agente => {
          const dias = agente.novedadesPorDia || {};
          let diasConX = 0;
          Object.values(dias).forEach(codigo => {
            if (conteo.hasOwnProperty(codigo)) conteo[codigo]++;
            if (codigo === 'X') diasConX++;
          });
          if (diasConX > 0) {
            detalleAusenciasX.push({
              area,
              codigo: agente.codigo || '',
              grado: agente.grado || '',
              apellidosNombres: agente.apellidosNombres || '',
              diasConX
            });
          }
        });

        filasPorArea.push({
          area,
          responsable: data.responsable || data.elaboradoPor || '—',
          totalPersonal: agentes.length,
          reemplazos: reemplazosPorArea[area] || 0,
          conteo,
          periodo
        });

        totales.total += agentes.length;
        CODIGOS_VALIDOS.forEach(c => { totales[c] += conteo[c]; });

      } catch(e) {
        console.warn(`Sin datos de ${area} para ${periodo}`);
      }
    }));
    tbodyProgreso.innerHTML = `<tr><td colspan="12" class="td-vacio">Cargando... ${Math.min(i + tamanioLoteResumen, areasReales.length)} / ${areasReales.length} áreas revisadas</td></tr>`;
  }

  filasPorArea.sort((a, b) => a.area.localeCompare(b.area));
  const totalReemplazos = filasPorArea.reduce((s, f) => s + f.reemplazos, 0);

  if (filasPorArea.length === 0) {
    tbody.innerHTML = `<tr><td colspan="12" class="td-vacio">No hay novedades registradas para ese mes</td></tr>`;
    return;
  }

  let html = '';
  filasPorArea.forEach(fila => {
    html += `<tr>
      <td>${fila.area}</td>
      <td>${fila.responsable}</td>
      <td style="text-align:center">${fila.totalPersonal}</td>
      <td style="text-align:center">${fila.reemplazos > 0 ? `<span style="background:var(--gold-l);color:var(--gold);padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700;">R · ${fila.reemplazos}</span>` : '—'}</td>
      ${CODIGOS_VALIDOS.map(c => `<td style="text-align:center;cursor:pointer;text-decoration:underline;" onclick="mostrarDetalleCodigo('${fila.area.replace(/'/g,"\\'")}','${fila.periodo}','${c}','${prefix}')">${fila.conteo[c]}</td>`).join('')}
    </tr>`;
  });

  html += `<tr style="font-weight:700;background:var(--bg);">
    <td>TOTAL GENERAL</td><td></td>
    <td style="text-align:center">${totales.total}</td>
    <td style="text-align:center">${totalReemplazos}</td>
    ${CODIGOS_VALIDOS.map(c => `<td style="text-align:center">${totales[c]}</td>`).join('')}
  </tr>`;

  tbody.innerHTML = html;

  resumenGeneralCache = { filasPorArea, totales, periodo, detalleAusenciasX, totalReemplazos };
}

async function exportarResumenGeneralExcel() {
  if (!resumenGeneralCache || !resumenGeneralCache.filasPorArea || resumenGeneralCache.filasPorArea.length === 0) {
    toast('Primero genere el resumen (botón "Generar resumen")', 'err');
    return;
  }
  if (!window.ExcelJS) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const { filasPorArea, totales, periodo, detalleAusenciasX, totalReemplazos } = resumenGeneralCache;
  const [anio] = periodo.split('-');

  // Colores (mismos que el spreadsheet de referencia)
  const NAVY   = 'FF1F3864';
  const ROJO   = 'FFC00000';
  const ROJO_CLARO = 'FFF4CCCC';
  const AZUL_CLARO = 'FFDCE6F1';
  const DORADO_CLARO = 'FFFFF2CC';
  const BLANCO = 'FFFFFFFF';

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Resumen General');

  const headers = ['ÁREA', 'RESPONSABLE (CÓD. - APELLIDO)', 'TOTAL PERSONAL', 'REEMPLAZOS (R)', 'S/N', 'OA', 'X (Ausentes)', 'CS', 'B (Bajas)', 'Li (Licencias)', 'V', 'PE'];
  ws.columns = [
    { width: 34 }, { width: 30 }, { width: 15 }, { width: 15 },
    { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 10 }, { width: 12 }, { width: 10 }, { width: 10 }
  ];

  // ── Título ──
  ws.mergeCells(1, 1, 1, headers.length);
  const tituloCell = ws.getCell(1, 1);
  tituloCell.value = `RESUMEN GENERAL DE NOVEDADES — CTE ${anio}`;
  tituloCell.font = { bold: true, size: 14, color: { argb: BLANCO } };
  tituloCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
  tituloCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(1).height = 24;

  // ── Encabezado ──
  const filaHeader = ws.addRow(headers);
  filaHeader.eachCell(cell => {
    cell.font = { bold: true, color: { argb: BLANCO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });

  // ── Filas por área (con X en rojo si hay ausentes, R en dorado si hay reemplazos) ──
  filasPorArea.forEach((fila, i) => {
    const filaRow = ws.addRow([
      fila.area, fila.responsable, fila.totalPersonal, fila.reemplazos || 0,
      ...CODIGOS_VALIDOS.map(c => fila.conteo[c])
    ]);
    if (i % 2 === 0) {
      filaRow.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } };
      });
    }
    const celdaR = filaRow.getCell(4); // columna D = Reemplazos (R)
    if (fila.reemplazos > 0) {
      celdaR.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: DORADO_CLARO } };
      celdaR.font = { bold: true };
    }
    const celdaX = filaRow.getCell(7); // columna G = X (Ausentes)
    if (fila.conteo['X'] > 0) {
      celdaX.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } };
      celdaX.font = { bold: true, color: { argb: BLANCO } };
    }
    filaRow.eachCell(cell => { cell.alignment = { horizontal: 'center' }; });
    filaRow.getCell(1).alignment = { horizontal: 'left' };
    filaRow.getCell(2).alignment = { horizontal: 'left' };
  });

  // ── Total general ──
  const filaTotal = ws.addRow(['TOTAL GENERAL', '', totales.total, totalReemplazos || 0, ...CODIGOS_VALIDOS.map(c => totales[c])]);
  filaTotal.eachCell(cell => {
    cell.font = { bold: true };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: AZUL_CLARO } };
    cell.alignment = { horizontal: 'center' };
  });
  filaTotal.getCell(1).alignment = { horizontal: 'left' };

  // ── Bloque de detalle de ausencias injustificadas ──
  ws.addRow([]);
  const filaBannerNum = ws.rowCount + 1;
  ws.mergeCells(filaBannerNum, 1, filaBannerNum, 5);
  const bannerCell = ws.getCell(filaBannerNum, 1);
  bannerCell.value = 'DETALLE DE AUSENCIAS INJUSTIFICADAS (X)';
  bannerCell.font = { bold: true, color: { argb: BLANCO } };
  bannerCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } };
  bannerCell.alignment = { horizontal: 'center', vertical: 'middle' };
  ws.getRow(filaBannerNum).height = 22;

  const filaHeaderDetalle = ws.addRow(['ÁREA', 'CÓDIGO', 'GRADO', 'APELLIDOS Y NOMBRES', 'DÍAS CON X']);
  filaHeaderDetalle.eachCell(cell => {
    cell.font = { bold: true, color: { argb: BLANCO } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: NAVY } };
    cell.alignment = { horizontal: 'center' };
  });

  if (detalleAusenciasX && detalleAusenciasX.length > 0) {
    detalleAusenciasX.forEach(d => {
      const fila = ws.addRow([d.area, d.codigo, d.grado, d.apellidosNombres, d.diasConX]);
      fila.eachCell(cell => {
        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO_CLARO } };
        cell.alignment = { horizontal: 'center' };
      });
      fila.getCell(1).alignment = { horizontal: 'left' };
      fila.getCell(4).alignment = { horizontal: 'left' };
    });

    ws.mergeCells(ws.rowCount + 1, 1, ws.rowCount + 1, 4);
    const filaTotalX = ws.addRow(['TOTAL DE PERSONAS CON AUSENCIA INJUSTIFICADA', '', '', '', detalleAusenciasX.length]);
    filaTotalX.eachCell(cell => {
      cell.font = { bold: true, color: { argb: BLANCO } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: ROJO } };
      cell.alignment = { horizontal: 'center' };
    });
  } else {
    ws.addRow(['Sin ausencias injustificadas este mes']);
  }

  // ── Descargar ──
  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/octet-stream' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `resumen_general_novedades_${periodo}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  toast('✅ Resumen exportado con colores', 'ok');
}

async function mostrarDetalleCodigo(area, periodo, codigo, prefix = 'resumen') {
  try {
    const ref = window._fb.doc(db, 'novedades', area, periodo, 'datos');
    const snap = await window._fb.getDoc(ref);
    if (!snap.exists()) return;
    const agentes = snap.data().agentes || [];

    const filas = [];
    agentes.forEach(agente => {
      const dias = agente.novedadesPorDia || {};
      const cantidad = Object.values(dias).filter(c => c === codigo).length;
      if (cantidad > 0) {
        filas.push({ area, codigo: agente.codigo || '', grado: agente.grado || '', nombre: agente.apellidosNombres || '', cantidad });
      }
    });

    $(`${prefix}-detalle-titulo`).textContent = `Detalle — ${area} — Código "${codigo}" (${CODIGOS_DESC[codigo] || ''})`;

    if (filas.length === 0) {
      $(`${prefix}-detalle-body`).innerHTML = `<tr><td colspan="5" class="td-vacio">Sin registros</td></tr>`;
    } else {
      $(`${prefix}-detalle-body`).innerHTML = filas.map(f => `
        <tr>
          <td>${f.area}</td><td>${f.codigo}</td><td>${f.grado}</td><td>${f.nombre}</td>
          <td style="text-align:center">${f.cantidad}</td>
        </tr>`).join('') + `
        <tr style="font-weight:700;background:var(--bg);">
          <td colspan="4">TOTAL DE PERSONAS CON "${codigo}"</td>
          <td style="text-align:center">${filas.length}</td>
        </tr>`;
    }

    show(`${prefix}-detalle-container`);
    $(`${prefix}-detalle-container`).scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   ENVÍOS (Funciones del sistema actual)
═════════════════════════════════════════ */


/* ══════════════════════════════════
   EXPONER AL HTML
══════════════════════════════════ */
window.login                        = login;
window.abrirSelectorArchivo         = abrirSelectorArchivo;
window.abrirSelectorActa            = abrirSelectorActa;
window.abrirSelectorInforme         = abrirSelectorInforme;
window.actaEstaDeshabilitada         = actaEstaDeshabilitada;
window.seleccionarActa              = seleccionarActa;
window.seleccionarInforme           = seleccionarInforme;
window.quitarActa                   = quitarActa;
window.quitarInforme                = quitarInforme;
window.abrirModalArchivado          = abrirModalArchivado;
window.cerrarModalArchivado         = cerrarModalArchivado;
window.abrirModalLimpiarDuplicados  = abrirModalLimpiarDuplicados;
window.cerrarModalLimpiarDuplicados = cerrarModalLimpiarDuplicados;
window.iniciarLimpiezaDuplicados    = iniciarLimpiezaDuplicados;
window.irEnvios                      = irEnvios;
window.seleccionarMesArchivado      = seleccionarMesArchivado;
window.archPaso2                    = archPaso2;
window.descargarMesCompleto         = descargarMesCompleto;
window.ir                           = ir;
window.show                         = show;
window.hide                         = hide;
window.toast                        = toast;
window.$                            = $;
window.abrirCarpetaArea             = abrirCarpetaArea;

/* Novedades */
window.irNovedades                  = irNovedades;
window.llenarSinNovedadHoy          = llenarSinNovedadHoy;
window.filtrarTablaPorCodigo        = filtrarTablaPorCodigo;
window.combinarDuplicadosArea       = combinarDuplicadosArea;
window.cerrarYExportarMes           = cerrarYExportarMes;
window.abrirModalEditarNovedad      = abrirModalEditarNovedad;
window.abrirModalEditarNovedadCierre = abrirModalEditarNovedadCierre;
window.cerrarModalNovedad           = cerrarModalNovedad;
window.guardarNovedad               = guardarNovedad;
window.actualizarObsSegunCodigo     = actualizarObsSegunCodigo;
window.mostrarErrorCodigo           = mostrarErrorCodigo;
window.cerrarErrorCodigo            = cerrarErrorCodigo;

/* Panel Admin — Novedades */
window.importarBaseDatos            = importarBaseDatos;
window.eliminarNovedadesAreaMes     = eliminarNovedadesAreaMes;
window.actualizarVisibilidadTabsPermiso = actualizarVisibilidadTabsPermiso;
window.guardarPermiso               = guardarPermiso;
window.marcarGrupoPermiso           = marcarGrupoPermiso;
window.eliminarPermiso              = eliminarPermiso;
window.editarPermiso                = editarPermiso;
window.desbloquearDiaDirecto        = desbloquearDiaDirecto;
window.borrarTodaLaBaseNovedades    = borrarTodaLaBaseNovedades;
window.mostrarFormAcceso            = mostrarFormAcceso;
window.cerrarModalAcceso            = cerrarModalAcceso;
window.abrirSelectorPersona         = abrirSelectorPersona;
window.cerrarModalSolicitudDesbloqueo = cerrarModalSolicitudDesbloqueo;
window.confirmarSolicitudDesbloqueo = confirmarSolicitudDesbloqueo;
window.solicitarDesbloqueoTodos     = solicitarDesbloqueoTodos;
window.cerrarSelectorPersona        = cerrarSelectorPersona;
window.filtrarListaPersonal         = filtrarListaPersonal;
window.elegirPersona                = elegirPersona;
window.generarReportePrueba         = generarReportePrueba;
window.exportarReporteActividadExcel = exportarReporteActividadExcel;
window.cambiarPaginaPersonasEnvio   = cambiarPaginaPersonasEnvio;
window.cambiarPaginaArchivosEnvio   = cambiarPaginaArchivosEnvio;
window.cambiarPaginaReporteActividad = cambiarPaginaReporteActividad;
window.cambiarPaginaAuditoria       = cambiarPaginaAuditoria;
window.filtrarPersonal              = filtrarPersonal;
window.cambiarPaginaPersonal        = cambiarPaginaPersonal;
window.abrirModalPersonal           = abrirModalPersonal;
window.editarRegistroPersonal       = editarRegistroPersonal;
window.cerrarModalPersonal          = cerrarModalPersonal;
window.guardarRegistroPersonal      = guardarRegistroPersonal;
window.eliminarRegistroPersonal     = eliminarRegistroPersonal;
window.toggleSeleccionPersonal      = toggleSeleccionPersonal;
window.toggleSeleccionarTodosPersonal = toggleSeleccionarTodosPersonal;
window.seleccionarTodosLosFiltradosPersonal = seleccionarTodosLosFiltradosPersonal;
window.limpiarSeleccionPersonal     = limpiarSeleccionPersonal;
window.aplicarCambioAreaLote        = aplicarCambioAreaLote;
window.confirmarGuardarAcceso       = confirmarGuardarAcceso;
window.guardarAcceso                = guardarAcceso;
window.eliminarAcceso               = eliminarAcceso;
window.editarAcceso                 = editarAcceso;
window.filtrarAuditoria             = filtrarAuditoria;
window.limpiarAuditoria             = limpiarAuditoria;
window.aprobarDesbloqueo            = aprobarDesbloqueo;
window.rechazarDesbloqueo           = rechazarDesbloqueo;
window.cerrarModalRechazarDesbloqueo = cerrarModalRechazarDesbloqueo;
window.responderConfirmacion        = responderConfirmacion;
window.intentarConfirmarGenerico    = intentarConfirmarGenerico;
window.confirmarRechazarDesbloqueo  = confirmarRechazarDesbloqueo;
window.cargarResumenGeneral         = cargarResumenGeneral;
window.exportarResumenGeneralExcel  = exportarResumenGeneralExcel;
window.mostrarDetalleCodigo         = mostrarDetalleCodigo;

/* ══════════════════════════════════
   MODO OSCURO / CLARO
══════════════════════════════════ */
function toggleModo() {
  const isDark = document.body.classList.toggle('dark-mode');
  localStorage.setItem('siscte-modo', isDark ? 'dark' : 'light');
  document.querySelectorAll('#btn-modo,#btn-modo-guest').forEach(b => {
    if (b) b.textContent = isDark ? '☀️' : '🌙';
  });
}
window.toggleModo = toggleModo;

// Conectar botones de modo al cargar
document.addEventListener('DOMContentLoaded', () => {
  // Restaurar modo guardado
  if (localStorage.getItem('siscte-modo') === 'dark') {
    document.body.classList.add('dark-mode');
  }
  const isDark = document.body.classList.contains('dark-mode');
  document.querySelectorAll('#btn-modo,#btn-modo-guest').forEach(b => {
    if (b) {
      b.textContent = isDark ? '☀️' : '🌙';
      b.addEventListener('click', toggleModo);
    }
  });
});
