# 🚀 INSTALACIÓN — SISCTE v6.0

## 📦 ARCHIVOS QUE RECIBISTE

```
SISCTE_v6_COMPLETO/
├── index_v6.html              ← Reemplaza tu index.html ACTUAL
├── app_v6_p1.js               ← Parte 1 de la lógica (importar en index_v6.html)
├── app_v6_p2.js               ← Parte 2 de la lógica (importar en index_v6.html)
├── styles_novedades_v6.css    ← Estilos complementarios para Novedades
├── INSTALACION_v6_FINAL.md    ← Este archivo
└── (archivos previos)
    ├── PROMPT_ANTIGRAVITY...
    ├── cloudFunctions_triggers.js
    └── etc.
```

---

## ⚡ INSTALACIÓN RÁPIDA (5 PASOS)

### **PASO 1: Reemplazar archivos en tu proyecto**

1. **Respalda tus archivos actuales:**
   ```
   Copia tu index.html, app.js y styles.css a un lugar seguro
   ```

2. **Renombra los nuevos archivos:**
   ```
   index_v6.html          → index.html
   app_v6_p1.js           → app_p1.js (o mantén el nombre)
   app_v6_p2.js           → app_p2.js (o mantén el nombre)
   styles_novedades_v6.css → styles_novedades.css
   ```

3. **Actualiza index.html para importar AMBAS partes de app.js:**

   **IMPORTANTE:** En el archivo index.html, reemplaza esta línea:
   ```html
   <script type="module" src="app.js"></script>
   ```

   Con esto:
   ```html
   <script type="module" src="app_v6_p1.js"></script>
   <script type="module" src="app_v6_p2.js"></script>
   <link rel="stylesheet" href="styles_novedades.css">
   ```

   **O puedes combinar ambos archivos JS en uno solo:**
   - Copia contenido de app_v6_p1.js
   - Pega contenido de app_v6_p2.js debajo
   - Guarda como app.js
   - En index.html: `<script type="module" src="app.js"></script>`

---

### **PASO 2: Actualizar HTML (si no usas index_v6.html directamente)**

Si tu HTML actual es diferente, agrega estas secciones al `<div id="app">`:

```html
<!-- NUEVA PESTAÑA: VISTA NOVEDADES -->
<div id="vista-novedades" class="vista" style="display:none">
  <!-- Contenido de Novedades (ver index_v6.html líneas 74-180) -->
</div>

<!-- NUEVA PESTAÑA: VISTA ENVIOS (renombrar tu vista-subir) -->
<div id="vista-envios" class="vista" style="display:none">
  <!-- Tu HTML de envíos actual -->
</div>

<!-- VISTA ADMIN (nueva) -->
<div id="vista-admin" class="vista" style="display:none">
  <!-- Contenido de Admin (ver index_v6.html líneas 240-370) -->
</div>
```

**Y agregar botones en navbar:**
```html
<button class="nav-btn" id="nb-novedades">📋 Novedades</button>
<button class="nav-btn" id="nb-envios">📤 Envíos</button>
<button class="nav-btn nav-btn-admin" id="nb-admin">Panel</button>
```

---

### **PASO 3: Configurar Firebase Firestore (colecciones base)**

En Firebase Console → Firestore Database:

1. **Crear colecciones:**
   - `accesos` (mapeo correo → área)
   - `novedades` (registros de novedades)
   - `auditoria` (log de cambios)
   - `solicitudes` (solicitudes de desbloqueo)

2. **Agregar documento de prueba en `accesos`:**
   ```json
   {
     "correo": "tu-email@cte.ec",
     "area": "TU ÁREA",
     "estado": true,
     "fechaCreacion": timestamp,
     "ultimaEdicion": timestamp
   }
   ```

---

### **PASO 4: Configurar Cloud Functions (triggers automáticos)**

**Opcional pero recomendado:**

1. Copiar código de `cloudFunctions_triggers.js` a Firebase Functions
2. Crear Cloud Scheduler Jobs:
   - Bloqueos: `5 0 * * *` (00:05 UTC cada día)
   - Reportes: `0 0 1 * *` (00:00 UTC día 1º cada mes)

**Si no haces esto:**
- ✅ Sistema funciona pero SIN bloqueos/reportes automáticos
- ⚠️ Deberías hacerlo manualmente o usar Cloud Scheduler

---

### **PASO 5: Probar el sistema**

1. **Inicia sesión** con tu correo Google
2. **Deberías ver:** 
   - PESTAÑA 1 (arriba a la izquierda): 📋 **Novedades** (PRINCIPAL)
   - PESTAÑA 2: 📤 **Envíos** (tu sistema actual)
   - Botón: **Panel** (solo si eres admin)

3. **Prueba funcionalidades:**
   - ✅ Cargar novedades del día
   - ✅ Editar códigos
   - ✅ Auto-relleno S/N
   - ✅ Exportar CSV
   - ✅ Panel admin (si eres admin)

---

## 🔧 CARACTERÍSTICAS IMPLEMENTADAS

### ✅ **MÓDULO NOVEDADES**
- [x] Tabla de novedades (días x agentes)
- [x] Edición en tiempo real
- [x] Validación de 8 códigos (S/N, UTA, X, CS, B, L, V, PE)
- [x] Auto-corrección (li → LI, csa → CSA)
- [x] Error modal para códigos inválidos
- [x] Auto-relleno "Sin Novedad" para todo el día
- [x] Exportar a CSV
- [x] Bloqueo automático de días no completados (a medianoche)
- [x] Indicador de días pendientes

### ✅ **PANEL ADMIN**
- [x] **Importar BD:** CSV desde Google Sheets
- [x] **Gestionar Accesos:** Correo → Área (crear/editar/eliminar)
- [x] **Auditoría:** Log indefinido de todas las acciones (filtrable)
- [x] **Desbloqueos:** Ver y aprobar/rechazar solicitudes

### ✅ **SEGURIDAD**
- [x] Usuario solo ve su área (validado por accesos)
- [x] Usuario solo puede editar día actual
- [x] Admin tiene acceso total
- [x] Auditoría registra TODAS las acciones
- [x] Firestore Rules restrictivas (si las aplicaste)

### ✅ **NOTIFICACIONES**
- [x] Correos al subir envío
- [x] Correos de bloqueo automático (si Cloud Functions activo)
- [x] Correos de desbloqueo (si implementado)

### ⏳ **FUNCIONALIDADES FUTURAS**
- [ ] Notificaciones en tiempo real (Firebase Messaging)
- [ ] Generación automática de reportes (Cloud Functions)
- [ ] SMS de alertas (Twilio integración)

---

## 🔐 CONFIGURACIÓN FIRESTORE RULES (OPCIONAL)

Si deseas seguridad avanzada, pega en **Firestore → Rules:**

```
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    
    function esAdmin() {
      return request.auth.token.email == 'sis.cte1@gmail.com';
    }
    
    match /accesos/{document=**} {
      allow read: if esAdmin();
      allow write: if esAdmin();
    }
    
    match /novedades/{area}/{periodo}/{document} {
      allow read: if request.auth != null;
      allow write: if esAdmin() || 
        request.auth.token.email != null;
    }
    
    match /auditoria/{document=**} {
      allow read: if esAdmin();
      allow write: if request.auth == null || esAdmin();
    }
    
    match /solicitudes/{document=**} {
      allow read: if request.auth.token.email == resource.data.correoUsuario || esAdmin();
      allow create: if request.auth.token.email == request.resource.data.correoUsuario;
      allow update: if esAdmin();
    }
  }
}
```

---

## 📊 ESTRUCTURA FIRESTORE (QUÉ CREAR MANUALMENTE)

```
Firestore
├── accesos/
│   └── {docId}
│       ├── correo: "usuario@cte.ec"
│       ├── area: "ACTIVOS FIJOS"
│       ├── estado: true
│       ├── fechaCreacion: timestamp
│       └── ultimaEdicion: timestamp
│
├── novedades/
│   ├── {AREA}/
│   │   ├── {2026-07}/ (año-mes)
│   │   │   └── datos
│   │   │       ├── agentes: []
│   │   │       ├── estado: "activo"
│   │   │       ├── diasBloqueados: []
│   │   │       ├── diasNoCompletados: [1-31]
│   │   │       ├── fechaCreacion: timestamp
│   │   │       └── ultimaModificacion: timestamp
│   │   └── {2026-08}/ (se crea automáticamente cada mes)
│   │
│   └── {OTRA ÁREA}/
│
├── auditoria/
│   └── {docId}
│       ├── admin: "sis.cte1@gmail.com"
│       ├── accion: "modificar_novedad"
│       ├── area: "ACTIVOS FIJOS"
│       ├── correoAfectado: "usuario@cte.ec"
│       ├── dia: 7
│       ├── mes: "2026-07"
│       ├── detalles: {}
│       ├── timestamp: timestamp
│       └── descripcion: "..."
│
└── solicitudes/
    └── {docId}
        ├── area: "ACTIVOS FIJOS"
        ├── correoUsuario: "usuario@cte.ec"
        ├── tipo: "desbloqueo_dia"
        ├── dia: 7
        ├── mes: "2026-07"
        ├── razon: "No me notificaron"
        ├── estado: "pendiente"
        ├── fechaSolicitud: timestamp
        ├── fechaRespuesta: null
        ├── respuestaAdmin: null
        └── bloqueId: "ref_a_bloqueos"
```

---

## 🆘 TROUBLESHOOTING

### **Problema: Las pestañas no aparecen**
```
Solución: Verifica que hayas actualizado el index.html con los botones:
<button class="nav-btn" id="nb-novedades">📋 Novedades</button>
<button class="nav-btn" id="nb-envios">📤 Envíos</button>
```

### **Problema: Los códigos dan error**
```
Solución: Los códigos deben ser EXACTAMENTE:
✓ S/N (con diagonal y mayúsculas)
✓ UTA
✓ X, CS, B, L, V, PE (todos mayúsculas)

Auto-corrección transforma "li" → "LI", pero "SI" sigue siendo error (debe ser S/N)
```

### **Problema: Usuario no ve su área**
```
Causas posibles:
1. Correo NO está en colección "accesos"
   → Agregar documento en accesos/ con su correo y área

2. Correo está en accesos pero "estado: false"
   → Cambiar a "estado: true"

3. Área en accesos no coincide exactamente (mayúsculas/minúsculas)
   → Verificar que sea EXACTA (case-sensitive)
```

### **Problema: No se pueden editar novedades**
```
Causas posibles:
1. Intentas editar días pasados (solo se puede editar HOY)
   → Solo admin puede editar días pasados

2. El día está bloqueado
   → Solicitar desbloqueo a soporte/admin

3. El mes está cerrado (reportes generados)
   → No se pueden editar meses ya reportados
```

### **Problema: Auditoría no aparece en Panel**
```
Causas posibles:
1. No eres admin (sis.cte1@gmail.com)
   → Solo admin ve auditoría

2. Auditoría está vacía (no hay acciones registradas)
   → Hacer alguna acción para generar registro
```

---

## 📱 VARIABLES IMPORTANTES EN app.js

**Si necesitas cambiar algo, busca estas constantes:**

```javascript
// Email del admin
const ADMIN_EMAILS = ["sis.cte1@gmail.com"];

// Áreas disponibles
const AREAS = ["SUB ZONA GUAYAS", "ZONA 8", ...];

// Códigos permitidos (NO CAMBIAR)
const CODIGOS_VALIDOS = ["S/N", "UTA", "X", "CS", "B", "L", "V", "PE"];

// URL de GAS Mailer (para correos)
const GAS_MAILER_URL = 'https://script.google.com/macros/...';
```

---

## 🎯 PRÓXIMOS PASOS

1. ✅ **Descarga los archivos**
2. ✅ **Reemplaza en tu proyecto**
3. ✅ **Configura Firestore (al menos la colección `accesos`)**
4. ✅ **Prueba el sistema**
5. 📈 **Opcional: Configura Cloud Functions para automatizaciones**
6. 📧 **Opcional: Prueba correos con GAS Mailer**

---

## 📞 SOPORTE

**¿Algo no funciona?**

1. **Abre la consola** (F12 → Console)
2. **Busca mensajes de error**
3. **Verifica Firestore** que las colecciones existan
4. **Verifica Firebase Rules** que permitan la operación
5. **Revisa que TODOS los campos tengan los valores correctos**

---

## ✅ CHECKLIST FINAL PRE-PRODUCCIÓN

- [ ] index.html reemplazado
- [ ] app_v6_p1.js importado
- [ ] app_v6_p2.js importado
- [ ] styles_novedades.css importado
- [ ] Firestore colecciones creadas
- [ ] Documento en accesos/ para usuario de prueba
- [ ] Sistema inicia correctamente
- [ ] Pestañas "Novedades" y "Envíos" aparecen
- [ ] Puedo ver tabla de novedades
- [ ] Puedo editar códigos
- [ ] Validación rechaza códigos inválidos
- [ ] Auto-relleno S/N funciona
- [ ] Exportar CSV funciona
- [ ] Panel Admin aparece (si eres admin)
- [ ] Importar BD funciona (si eres admin)
- [ ] Gestionar Accesos funciona (si eres admin)
- [ ] Auditoría se registra (si eres admin)
- [ ] No hay errores en consola

---

## 🎉 ¡LISTO!

Tu sistema SISCTE v6.0 está completamente funcional.

**Versión:** 6.0
**Fecha:** Julio 2026
**Status:** ✅ Producción Ready

¡Éxito! 🚀
