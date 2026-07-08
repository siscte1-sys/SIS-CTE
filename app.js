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

    onAuthStateChanged(auth, u => {
      if (u) {
        usuario = { uid: u.uid, nombre: u.displayName, email: u.email, foto: u.photoURL };
        actualizarNav();
        show('nb-novedades');                              // Novedades: todos los usuarios
        show('nb-envios');                                  // Envíos: todos los usuarios
        esAdmin() ? show('nb-admin') : hide('nb-admin');   // Panel de control: solo admin
        irEnvios();
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
   DOM HELPERS
══════════════════════════════════ */
const $       = id => document.getElementById(id);
const show    = id => { const e=$(id); if(!e) return; e.style.display = ['nav-sesion','nav-guest','nav-right'].includes(id) ? 'flex' : 'block'; };
const hide    = id => { const e=$(id); if(e) e.style.display='none'; };
const hideAll = () => ['vista-login','vista-novedades','vista-envios','vista-exito','vista-admin'].forEach(hide);

function ir(v) {
  hideAll();
  const el = $(v); if (!el) return;
  el.style.display = v === 'vista-login' ? 'flex' : 'block';
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
  if (v==='vista-envios'||v==='vista-exito') $('nb-envios')?.classList.add('active');
  if (v==='vista-novedades') $('nb-novedades')?.classList.add('active');
  if (v==='vista-admin') $('nb-admin')?.classList.add('active');
}

function irNovedades() { ir('vista-novedades'); cargarNovedadesActuales(); }

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
    esAdmin() ? show('nb-admin') : hide('nb-admin');
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

async function poblarSelectorAreaAdmin() {
  const cont = $('admin-selector-area-novedades');
  const sel = $('select-area-admin-novedades');
  if (!cont || !sel) return;
  show('admin-selector-area-novedades');
  cont.style.display = 'block';
  if (sel.options.length === 0) {
    AREAS.forEach(a => {
      const opt = document.createElement('option');
      opt.value = a; opt.textContent = a;
      sel.appendChild(opt);
    });
    sel.value = areaActual || AREAS[0];
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
      if (!areaActual) areaActual = AREAS[0];
      await poblarSelectorAreaAdmin();
    } else {
      hide('admin-selector-area-novedades');
      // Obtener area del usuario desde accesos
      const accesoRef = window._fb.collection(db, 'accesos');
      const q = window._fb.query(accesoRef, window._fb.where('correo', '==', usuario.email));
      const querySnapshot = await window._fb.getDocs(q);

      if (querySnapshot.empty) {
        toast('❌ Tu correo no está configurado en el sistema. Contacta a soporte.', 'err');
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

function renderizarTablaNovedades(diaHoy) {
  const tabla = $('tabla-novedades');
  const thead = tabla.querySelector('thead tr');
  const tbody = $('tabla-novedades-body');
  
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
        const bloqueado = dia < new Date().getDate() && !desbloqueadoPorAdmin;
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
      toast('Ya tenés una solicitud pendiente para ese día. Esperá la respuesta del administrador.', 'ok');
      return;
    }

    const razon = prompt(`El día ${dia} está bloqueado. Contale al administrador por qué necesitás editarlo:`);
    if (!razon) return;

    await window._fb.addDoc(solRef, {
      area: areaActual,
      correoUsuario: usuario.email,
      tipo: 'desbloqueo_dia',
      dia: dia,
      mes: mesActual,
      razon: razon,
      estado: 'pendiente',
      fechaSolicitud: new Date(),
      fechaRespuesta: null,
      respuestaAdmin: null
    });

    toast('✅ Solicitud enviada. El administrador la va a revisar.', 'ok');
  } catch(e) {
    console.error(e);
    toast('❌ Error enviando solicitud: ' + e.message, 'err');
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

  $('cierre-elaborado-por').value = data.elaboradoPor || '';
  $('cierre-responsable').value = data.responsable || '';
}

function ocultarPantallaCierreMes() {
  hide('cierre-mes-container');
  cierreMesData = null;
}

function renderizarTablaSoloLectura(tabla, data, periodo) {
  const totalDias = diasEnMes(periodo);
  let html = '<thead><tr><th>Código</th><th>Grado</th><th>Apellidos y Nombres</th>';
  for (let d = 1; d <= 31; d++) html += `<th style="width:32px;${d > totalDias ? 'opacity:.25' : ''}">${d}</th>`;
  html += '<th>Observación</th></tr></thead><tbody>';

  (data.agentes || []).forEach(agente => {
    html += `<tr><td style="font-size:11px">${agente.codigo || ''}</td><td style="font-size:11px">${agente.grado || ''}</td><td style="font-size:11px;text-align:left">${agente.apellidosNombres || ''}</td>`;
    for (let d = 1; d <= 31; d++) {
      const valor = (agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || '';
      html += `<td style="font-size:11px;${d > totalDias ? 'opacity:.25' : ''}">${d > totalDias ? '' : (valor || '—')}</td>`;
    }
    html += `<td style="font-size:11px">${agente.observaciones || ''}</td></tr>`;
  });
  html += '</tbody>';
  tabla.innerHTML = html;
}

async function cerrarYExportarMes() {
  if (!cierreMesData) return;
  const elaboradoPor = $('cierre-elaborado-por').value.trim();
  const responsable = $('cierre-responsable').value.trim();

  if (!elaboradoPor || !responsable) {
    toast('❌ Completá "Elaborado por" y "Responsable" antes de cerrar el mes', 'err');
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
  if (!window.XLSX) {
    await new Promise((res, rej) => {
      const s = document.createElement('script');
      s.src = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
      s.onload = res; s.onerror = rej; document.head.appendChild(s);
    });
  }

  const totalDias = diasEnMes(periodo);
  const [anio, mesNum] = periodo.split('-');
  const nombreMes = obtenerNombreMes(mesNum);
  const numCols = 3 + 31 + 1; // código, grado, nombres + 31 días + observación

  const aoa = [];
  aoa.push(['COMISIÓN DE TRÁNSITO DEL ECUADOR — CONTROL DE NOVEDADES MENSUAL']);
  aoa.push([`ÁREA: ${area}   ·   MES: ${nombreMes} ${anio}`]);
  aoa.push([]);

  const headerRow = ['CÓDIGO', 'GRADO', 'APELLIDOS Y NOMBRES'];
  for (let d = 1; d <= 31; d++) headerRow.push(d);
  headerRow.push('OBSERVACIÓN');
  aoa.push(headerRow);

  (data.agentes || []).forEach(agente => {
    const fila = [agente.codigo || '', agente.grado || '', agente.apellidosNombres || ''];
    for (let d = 1; d <= 31; d++) {
      if (d > totalDias) { fila.push(''); continue; }
      fila.push((agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || '');
    }
    fila.push(agente.observaciones || '');
    aoa.push(fila);
  });

  aoa.push([]);
  aoa.push(['NOMENCLATURA']);
  CODIGOS_VALIDOS.forEach(c => aoa.push([c, CODIGOS_DESC[c]]));
  aoa.push([]);
  aoa.push(['NOTA: Para meses de 28, 29 o 30 días, se dejan en blanco las columnas de los días que no existen en ese mes.']);
  aoa.push([]);
  aoa.push(['CERTIFICACIÓN']);
  aoa.push(['ELABORADO POR', '', 'RESPONSABLE']);
  aoa.push([elaboradoPor, '', responsable]);

  const ws = XLSX.utils.aoa_to_sheet(aoa);

  ws['!merges'] = [
    { s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } },
    { s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } },
  ];
  const filaNomenclatura = 4 + (data.agentes || []).length + 1;
  ws['!merges'].push({ s: { r: filaNomenclatura, c: 0 }, e: { r: filaNomenclatura, c: numCols - 1 } });
  const filaNota = filaNomenclatura + CODIGOS_VALIDOS.length + 1;
  ws['!merges'].push({ s: { r: filaNota, c: 0 }, e: { r: filaNota, c: numCols - 1 } });
  const filaCertTitulo = filaNota + 2;
  ws['!merges'].push({ s: { r: filaCertTitulo, c: 0 }, e: { r: filaCertTitulo, c: numCols - 1 } });
  ws['!merges'].push({ s: { r: filaCertTitulo + 1, c: 0 }, e: { r: filaCertTitulo + 1, c: 1 } });
  ws['!merges'].push({ s: { r: filaCertTitulo + 1, c: 2 }, e: { r: filaCertTitulo + 1, c: numCols - 1 } });
  ws['!merges'].push({ s: { r: filaCertTitulo + 2, c: 0 }, e: { r: filaCertTitulo + 2, c: 1 } });
  ws['!merges'].push({ s: { r: filaCertTitulo + 2, c: 2 }, e: { r: filaCertTitulo + 2, c: numCols - 1 } });

  ws['!cols'] = [{wch:8},{wch:14},{wch:32}, ...Array.from({length:31},()=>({wch:4})), {wch:20}];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Novedades');
  XLSX.writeFile(wb, `novedades_${area}_${periodo}.xlsx`);
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

  const doc = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'landscape' });

  doc.setFontSize(12);
  doc.setFont(undefined, 'bold');
  doc.text('COMISIÓN DE TRÁNSITO DEL ECUADOR — CONTROL DE NOVEDADES MENSUAL', 148, 12, { align: 'center' });
  doc.setFontSize(10);
  doc.setFont(undefined, 'normal');
  doc.text(`ÁREA: ${area}   ·   MES: ${nombreMes} ${anio}`, 148, 18, { align: 'center' });

  const head = [['Código', 'Grado', 'Apellidos y Nombres', ...Array.from({length: totalDias}, (_, i) => String(i + 1)), 'Observación']];
  const body = (data.agentes || []).map(agente => {
    const fila = [agente.codigo || '', agente.grado || '', agente.apellidosNombres || ''];
    for (let d = 1; d <= totalDias; d++) fila.push((agente.novedadesPorDia && agente.novedadesPorDia[String(d)]) || '');
    fila.push(agente.observaciones || '');
    return fila;
  });

  doc.autoTable({
    head, body,
    startY: 22,
    styles: { fontSize: 6, cellPadding: 1 },
    headStyles: { fillColor: [37, 99, 235] }
  });

  let y = doc.lastAutoTable.finalY + 8;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('NOMENCLATURA', 14, y);
  y += 5;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(8);
  CODIGOS_VALIDOS.forEach(c => {
    doc.text(`${c} — ${CODIGOS_DESC[c]}`, 14, y);
    y += 4;
  });

  y += 6;
  doc.setFontSize(9);
  doc.setFont(undefined, 'bold');
  doc.text('CERTIFICACIÓN', 14, y);
  y += 7;
  doc.setFont(undefined, 'normal');
  doc.setFontSize(9);
  doc.text(`Elaborado por: ${elaboradoPor}`, 14, y);
  doc.text(`Responsable: ${responsable}`, 148, y);

  doc.save(`novedades_${area}_${periodo}.pdf`);
}

/* ═════════════════════════════════════════
   PANEL ADMIN — Importar BD
═════════════════════════════════════════ */


/* ══════════════════════════════════
   AREAS
══════════════════════════════════ */
function poblarAreas(selectId, placeholder='— Selecciona tu área —') {
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
  lista.innerHTML=`<div class="mis-envios-vacio"><p style="font-size:12px;color:var(--txt3);">Cargando tus envíos...</p></div>`;
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
  $('nb-admin')?.addEventListener('click', () => { if(esAdmin()){ ir('vista-admin'); cargarAdmin(); } });
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
      document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
      tab.classList.add('active');
      const content = $(`admin-tab-${tabName}`);
      if (content) content.style.display = 'block';
      if (tabName === 'envios')      cargarAdmin();
      if (tabName === 'accesos')     cargarAccesos();
      if (tabName === 'auditoria')   cargarAuditoria();
      if (tabName === 'desbloqueos') cargarDesbloqueos();
      if (tabName === 'resumen') { poblarSelectoresResumen(); cargarResumenGeneral(); }
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
      hint.textContent = 'Sube el archivo comprimido (RAR o ZIP) para habilitar el envío';
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
  if (!archivoSeleccionado) { toast('Selecciona un archivo comprimido (RAR o ZIP) primero','err'); return; }
  if (!informeSeleccionado) { toast('El Informe de Entrega PDF es obligatorio','err'); return; }

  const actaObligatoria = actaEsObligatoriaHoy();
  if (actaObligatoria && !actaSeleccionada) {
    const _info = infoPlazoPorFecha();
    toast(`⚠️ Envío tardío del reporte de ${_info.mesReporte} — el Acta PDF es obligatoria`, 'err');
    return;
  }

  const areaVal    = $('area-select').value;
  if (!areaVal) { toast('Debes seleccionar tu área','err'); return; }
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
    doc.text('Tu entrega fue guardada correctamente en el sistema SISCTE.', W/2, 85, { align:'center' });

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
    doc.text('Guarda este comprobante como respaldo de tu entrega en el sistema SISCTE.', 20, y+6);
    doc.setFont('helvetica','normal');
    doc.text('Tu archivo fue almacenado en Google Drive y el registro queda permanente.', 20, y+12);

    doc.setFillColor(37,99,235);
    doc.rect(0, 275, W, 22, 'F');
    doc.setTextColor(255,255,255); doc.setFontSize(8); doc.setFont('helvetica','normal');
    doc.text('Sistema SISCTE — Generado el '+d.fecha+' a las '+d.hora, 14, 284);
    doc.text('siscte1-sys.github.io/SIS-CTE', W-14, 284, { align:'right' });
    doc.setFontSize(7); doc.setTextColor(179,207,255);
    doc.text('Este documento es un comprobante automático de tu entrega.', W/2, 290, { align:'center' });

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

  $('admin-personas').innerHTML = Object.values(porPersona).sort((a,b)=>b.cant-a.cant).map(p=>`
    <div class="persona-row">
      <img class="persona-foto" src="${p.foto||avatar(p.nombre)}" alt="" onerror="this.src='${avatar(p.nombre)}'">
      <div class="persona-info">
        <div class="persona-nombre">${p.nombre||'—'}</div>
        <div class="persona-email">${p.email}</div>
        <div class="persona-ultima">Área(s): ${[...p.areas].join(', ')||'—'} · Último: ${p.fechaTexto} · ${p.horaTexto}</div>
      </div>
      <button type="button" class="persona-badge persona-badge-link" onclick="abrirCarpetaArea('${p.area||''}')" title="Abrir carpeta de ${p.area||'su área'} en Drive">${p.cant} archivo${p.cant>1?'s':''}</button>
    </div>`).join('') || '<p class="cargando-txt">Sin entregas</p>';

  $('tabla-body').innerHTML = !docs.length
    ? `<tr><td colspan="9" class="td-vacio">No hay registros</td></tr>`
    : docs.map((d,i) => `
      <tr class="${d.archivado?'tr-archivado':''}">
        <td class="td-n">${i+1}</td>
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

  $('filtro-resultado').textContent = `${docs.length} registro${docs.length!==1?'s':''} encontrado${docs.length!==1?'s':''}`;
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
  sel.innerHTML = '<option value="">— Selecciona el mes —</option>';
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
      toast('⚠️ Ingresa un nombre para la colección', 'warn');
      return;
    }
    
    if (!fileInput.files || fileInput.files.length === 0) {
      toast('⚠️ Selecciona un archivo CSV o Excel', 'warn');
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
    
    // Parsear filas (saltar encabezado)
    const datos = {};
    for (let i = 1; i < filas.length; i++) {
      const partes = filas[i];
      if (!partes || partes.length < 6) continue;
      
      const area = sanitizarNombreArea(partes[5] || 'SIN ÁREA');
      if (!datos[area]) datos[area] = [];
      
      datos[area].push({
        numero: partes[0],
        codigo: partes[1],
        grado: partes[2],
        apellidosNombres: partes[3],
        cedula: partes[4],
        novedadesPorDia: {},
        observaciones: ''
      });
    }
    
    // Guardar en Firestore — se FUSIONA con lo existente, nunca se sobrescribe
    // (si un agente rota de área a mitad de mes, sigue apareciendo en la anterior
    //  con lo ya registrado, y se agrega también a la nueva sin perder nada)
    const dateParts = obtenerFechaParts();
    const periodo = dateParts.periodo;
    const areasNoReconocidas = [];

    for (const [area, agentesNuevos] of Object.entries(datos)) {
      if (!AREAS.includes(area)) areasNoReconocidas.push(area);

      const novedadesRef = window._fb.doc(db, 'novedades', area, periodo, 'datos');
      const existente = await window._fb.getDoc(novedadesRef);
      const dataExistente = existente.exists() ? existente.data() : null;
      const agentesFinal = dataExistente ? [...(dataExistente.agentes || [])] : [];

      agentesNuevos.forEach(nuevo => {
        const yaExiste = nuevo.cedula && agentesFinal.some(a => a.cedula === nuevo.cedula);
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

    if (areasNoReconocidas.length > 0) {
      toast(`⚠️ Estas áreas del CSV no coinciden con la lista AREAS del sistema y no aparecerán en los selectores: ${areasNoReconocidas.join(', ')}`, 'err');
    }
    
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
            ${data.razon ? `<div style="font-size:11px;color:var(--txt3);margin-top:2px;">"${data.razon}"</div>` : ''}
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
    const solRef = window._fb.doc(db, 'solicitudes', docId);
    const solDoc = await window._fb.getDoc(solRef);
    if (!solDoc.exists()) { toast('❌ Solicitud no encontrada', 'err'); return; }
    const sol = solDoc.data();

    await window._fb.updateDoc(solRef, {
      estado: 'aprobada',
      fechaRespuesta: new Date()
    });

    // Habilitar la edición de ese día puntual en el documento de Novedades del área/mes correspondiente
    if (sol.area && sol.dia && sol.mes) {
      const novedadesRef = window._fb.doc(db, 'novedades', sol.area, sol.mes, 'datos');
      const novedadesDoc = await window._fb.getDoc(novedadesRef);
      if (novedadesDoc.exists()) {
        const data = novedadesDoc.data();
        const diasDesbloqueados = data.diasDesbloqueados || [];
        if (!diasDesbloqueados.includes(sol.dia)) diasDesbloqueados.push(sol.dia);
        await window._fb.updateDoc(novedadesRef, { diasDesbloqueados });
      }
      await registrarEnAuditoria('aprobar_desbloqueo', sol.area, sol.correoUsuario, sol.dia, sol.mes, {}, `Día ${sol.dia} desbloqueado para ${sol.correoUsuario}`);
    }

    toast('✅ Desbloqueo aprobado — el día ya se puede editar', 'ok');
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
   PANEL ADMIN — Resumen General de Novedades
═════════════════════════════════════════ */

function poblarSelectoresResumen() {
  const selMes = $('resumen-mes');
  const selAnio = $('resumen-anio');
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

async function cargarResumenGeneral() {
  const mes = $('resumen-mes').value;
  const anio = $('resumen-anio').value;
  if (!mes || !anio) { toast('Elegí mes y año', 'err'); return; }
  const periodo = `${anio}-${mes}`;

  const tbody = $('resumen-tabla-body');
  tbody.innerHTML = `<tr><td colspan="11" class="td-vacio">Cargando...</td></tr>`;
  hide('resumen-detalle-container');

  const filasPorArea = [];
  const totales = { total: 0, 'S/N':0, 'OA':0, 'X':0, 'CS':0, 'B':0, 'Li':0, 'V':0, 'PE':0 };

  for (const area of AREAS) {
    try {
      const ref = window._fb.doc(db, 'novedades', area, periodo, 'datos');
      const snap = await window._fb.getDoc(ref);
      if (!snap.exists()) continue;
      const data = snap.data();
      const agentes = data.agentes || [];
      if (agentes.length === 0) continue;

      const conteo = { 'S/N':0, 'OA':0, 'X':0, 'CS':0, 'B':0, 'Li':0, 'V':0, 'PE':0 };
      agentes.forEach(agente => {
        const dias = agente.novedadesPorDia || {};
        Object.values(dias).forEach(codigo => {
          if (conteo.hasOwnProperty(codigo)) conteo[codigo]++;
        });
      });

      filasPorArea.push({
        area,
        responsable: data.responsable || data.elaboradoPor || '—',
        totalPersonal: agentes.length,
        conteo,
        periodo
      });

      totales.total += agentes.length;
      CODIGOS_VALIDOS.forEach(c => { totales[c] += conteo[c]; });

    } catch(e) {
      console.warn(`Sin datos de ${area} para ${periodo}`);
    }
  }

  if (filasPorArea.length === 0) {
    tbody.innerHTML = `<tr><td colspan="11" class="td-vacio">No hay novedades registradas para ese mes</td></tr>`;
    return;
  }

  let html = '';
  filasPorArea.forEach(fila => {
    html += `<tr>
      <td>${fila.area}</td>
      <td>${fila.responsable}</td>
      <td style="text-align:center">${fila.totalPersonal}</td>
      ${CODIGOS_VALIDOS.map(c => `<td style="text-align:center;cursor:pointer;text-decoration:underline;" onclick="mostrarDetalleCodigo('${fila.area.replace(/'/g,"\\'")}','${fila.periodo}','${c}')">${fila.conteo[c]}</td>`).join('')}
    </tr>`;
  });

  html += `<tr style="font-weight:700;background:var(--bg);">
    <td>TOTAL GENERAL</td><td></td>
    <td style="text-align:center">${totales.total}</td>
    ${CODIGOS_VALIDOS.map(c => `<td style="text-align:center">${totales[c]}</td>`).join('')}
  </tr>`;

  tbody.innerHTML = html;
}

async function mostrarDetalleCodigo(area, periodo, codigo) {
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

    $('resumen-detalle-titulo').textContent = `Detalle — ${area} — Código "${codigo}" (${CODIGOS_DESC[codigo] || ''})`;

    if (filas.length === 0) {
      $('resumen-detalle-body').innerHTML = `<tr><td colspan="5" class="td-vacio">Sin registros</td></tr>`;
    } else {
      $('resumen-detalle-body').innerHTML = filas.map(f => `
        <tr>
          <td>${f.area}</td><td>${f.codigo}</td><td>${f.grado}</td><td>${f.nombre}</td>
          <td style="text-align:center">${f.cantidad}</td>
        </tr>`).join('') + `
        <tr style="font-weight:700;background:var(--bg);">
          <td colspan="4">TOTAL DE PERSONAS CON "${codigo}"</td>
          <td style="text-align:center">${filas.length}</td>
        </tr>`;
    }

    show('resumen-detalle-container');
    $('resumen-detalle-container').scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

/* ═════════════════════════════════════════
   ENVÍOS (Funciones del sistema actual)
═════════════════════════════════════════ */


async function editarAcceso(docId) {
  const nuevaArea = prompt('Nueva área para este acceso (deja vacío para cancelar):');
  if (!nuevaArea) return;
  if (!AREAS.includes(nuevaArea)) {
    toast('❌ Área no válida. Debe coincidir exactamente con una de las áreas configuradas.', 'err');
    return;
  }
  try {
    await window._fb.updateDoc(window._fb.doc(db, 'accesos', docId), {
      area: nuevaArea,
      ultimaEdicion: new Date()
    });
    await registrarEnAuditoria('editar_acceso', nuevaArea, null, null, null, {}, `Acceso ${docId} actualizado a ${nuevaArea}`);
    toast('✅ Acceso actualizado', 'ok');
    cargarAccesos();
  } catch(e) {
    toast('Error: ' + e.message, 'err');
  }
}

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
window.cerrarYExportarMes           = cerrarYExportarMes;
window.abrirModalEditarNovedad      = abrirModalEditarNovedad;
window.cerrarModalNovedad           = cerrarModalNovedad;
window.guardarNovedad               = guardarNovedad;
window.mostrarErrorCodigo           = mostrarErrorCodigo;
window.cerrarErrorCodigo            = cerrarErrorCodigo;

/* Panel Admin — Novedades */
window.importarBaseDatos            = importarBaseDatos;
window.mostrarFormAcceso            = mostrarFormAcceso;
window.guardarAcceso                = guardarAcceso;
window.eliminarAcceso               = eliminarAcceso;
window.editarAcceso                 = editarAcceso;
window.filtrarAuditoria             = filtrarAuditoria;
window.limpiarAuditoria             = limpiarAuditoria;
window.aprobarDesbloqueo            = aprobarDesbloqueo;
window.rechazarDesbloqueo           = rechazarDesbloqueo;
window.cargarResumenGeneral         = cargarResumenGeneral;
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
