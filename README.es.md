# AliExpress Coin Collector & Task Runner

> 🌐 **Idiomas:** [Português](README.md) | [English](README.en.md) | [Español](README.es.md)

> ℹ️ Traducción al español de la documentación canónica en portugués. En caso de divergencia, prevalece la versión en portugués.

Automatización completa para el **check-in diario de monedas** y la **ejecución de tareas ("Gana más monedas")** de AliExpress con emulación móvil (Google Pixel 7 / Android) mediante Playwright.

Compatible con **Linux (Ubuntu / Debian)**, **Windows 10/11** y **macOS (Apple Silicon e Intel)**.

Requiere **Node.js >= 22** (`.nvmrc: 22`).

---

## Funciones principales

- **Modo unificado (un solo comando):** ejecuta el check-in diario y todas las tareas del panel en secuencia, generando un informe consolidado con saldo inicial, ganancia por tarea y saldo final.
- **Check-in diario inteligente:** compatible con el diseño de tarjetas de AliExpress. Mantiene rachas activas (incluidas 200+ días) y valores progresivos (+10 hasta +40 monedas/día). Detección bilingüe de saldo ("My coins" / "Minhas moedas").
- **Tareas diarias automatizadas:** ejecuta tareas por lotes (productos sorpresa con permanencia real, búsqueda por palabras clave y navegación con scroll).
- **Sesión resiliente y cambio de cuenta:** validación estricta de cookies (`xman_us_t`). Detecta cambios de cuenta en `credentials.env` y renueva las credenciales de forma segura.
- **Cifrado v3 de alta seguridad:** exportación segura de la sesión usando derivación mediante `scrypt` con salt criptográfico dinámico de 16 bytes, parámetros explícitos y cifrado `AES-256-GCM` (formato `v3:N:r:p:salt:iv:tag:ct:base64`). Mantiene compatibilidad con tokens heredados `v1` y `v2`.
- **Lockfile con prevención de concurrencia y stale timeout:** evita ejecuciones superpuestas en Cron con comprobación de hostname + PID y timeout de inactividad (predeterminado: 30 min).
- **Diagnósticos de Playwright:** captura automática de trace (configurable mediante `PW_TRACE`; `retain-on-failure` en el perfil predeterminado, `off` en modo low-memory), capturas de pantalla (`only-on-failure`) y vídeo opcional en `scratch/`.

---

## Modos de ejecución

| Modo                        | Descripción                                          | Windows CMD             | Windows PowerShell | Linux / macOS            | npm                      |
| :-------------------------- | :--------------------------------------------------- | :---------------------- | :----------------- | :----------------------- | :----------------------- |
| **Unificado (recomendado)** | Check-in + todas las tareas en secuencia             | `run_all.bat`           | `.\run_all.ps1`    | `./run_all.sh`           | `npm start`              |
| **Solo check-in**           | Check-in diario y consulta de saldo                  | `run.bat`               | `.\run.ps1`        | `./run.sh`               | `npm run collect`        |
| **Solo tareas**             | Panel "Gana más monedas"                             | `run_tasks.bat`         | `.\run_tasks.ps1`  | `./run_tasks.sh`         | `npm run tasks`          |
| **Validación (dry-run)**    | Valida credenciales y entorno sin abrir el navegador | `run_all.bat --dry-run` | `.\run_all.ps1 -d` | `./run_all.sh --dry-run` | `npm start -- --dry-run` |

> 💡 **Windows (codificación):** los scripts `run_all.bat`/`.\run_all.ps1` (y las demás variantes)
> ya configuran la consola para UTF-8. Si ejecutas mediante `npm start`/`node` directamente, ejecuta
> antes `chcp 65001` (CMD) o `[Console]::OutputEncoding = [System.Text.Encoding]::UTF8; chcp 65001 > $null`
> (PowerShell) para no ver acentos/emojis rotos en el log.

---

## Opciones de línea de comandos (CLI)

La CLI admite las siguientes flags unificadas (mediante `commander`):

| Flag                 | Descripción                                                                                                                                    |
| :------------------- | :--------------------------------------------------------------------------------------------------------------------------------------------- |
| `-d, --dry-run`      | Ejecuta la validación completa de credenciales y entorno sin iniciar Chromium.                                                                 |
| `--check-session`    | Comprobación **de solo lectura**: abre la central de monedas e indica si la sesión sigue autenticada (saldo/racha), sin check-in ni tareas.    |
| `-f, --force`        | Fuerza la ejecución: sobrescribe un lockfile activo **e ignora el cooldown posterior al captcha** (intenta el login incluso durante la pausa). |
| `--no-delay`         | No aplica el retraso inicial aleatorio (`START_DELAY_MIN_MS`/`START_DELAY_MAX_MS`) en esta ejecución (manuales/reintentos).                    |
| `--json`             | Emite el informe de ejecución, diagnósticos y validación en formato JSON puro.                                                                 |
| `--lang <pt-BR\|en>` | Idioma de la interfaz y de los logs: `pt-BR` (predeterminado) o `en` (English). También se puede definir con `APP_LANGUAGE`.                   |
| `--notify`           | Fuerza el envío de notificaciones de Telegram para la ejecución actual.                                                                        |
| `--no-notify`        | Desactiva el envío de notificaciones de Telegram para la ejecución actual.                                                                     |
| `--manual-login`     | Abre una ventana para el login manual cuando sea necesario (equivale a `MANUAL_LOGIN=always`).                                                 |
| `--no-manual-login`  | Nunca ofrece login manual; mantiene el 100 % headless (equivale a `MANUAL_LOGIN=never`).                                                       |
| `--heartbeat`        | Fuerza el envío de heartbeat / dead man's switch para la ejecución actual.                                                                     |
| `--no-heartbeat`     | Desactiva el envío de heartbeat / dead man's switch para la ejecución actual.                                                                  |
| `--all`              | Procesa todas las cuentas configuradas (usado por `export_session.js`/`import_session.js`).                                                    |
| `--account <id>`     | Selecciona la cuenta por índice o correo electrónico en las CLI de sesión.                                                                     |
| `--plaintext`        | Permite guardar la sesión sin cifrado (opt-out explícito del at-rest).                                                                         |
| `--keep-tokens`      | No elimina los `session_token*.txt` tras la importación (lote o `--from-file`).                                                                |
| `--allow-expired`    | Permite importar un token cuya validez estimada (`expiresAt`, ~90 días) ya pasó. Úsalo con cautela.                                            |
| `--rotate`           | Vuelve a cifrar las sesiones con la nueva clave (`SESSION_SECRET_NEW`/`SESSION_SECRET_OLD`).                                                   |
| `--migrate`          | Migra `session.json` heredado a `session.json.enc` mediante `import_session.js`.                                                               |
| `--version`          | Muestra la versión del proyecto.                                                                                                               |
| `--show-token`       | Muestra el token cifrado en la salida del terminal durante `export_session.js`.                                                                |
| `--from-file <ruta>` | Lee el token cifrado desde el archivo especificado durante `import_session.js`.                                                                |
| `-h, --help`         | Muestra el mensaje de ayuda con la lista de parámetros disponibles.                                                                            |

Ejemplo de diagnóstico sin efectos secundarios:

```bash
npm start -- --check-session            # todas las cuentas configuradas
npm start -- --check-session --json     # salida JSON (type=session_check)
node collect.js --check-session         # cuenta única / --account <id>
```

El código de salida es `0` cuando todas las sesiones son válidas y `1` cuando alguna falla.
En este modo no se ejecuta ningún check-in, tarea, notificación ni heartbeat.

---

## Códigos de salida (Exit Codes)

Los scripts devuelven códigos de salida estandarizados para integración continua y automatización mediante Cron/Task Scheduler:

| Código  | Significado              | Descripción                                                                                 |
| :-----: | :----------------------- | :------------------------------------------------------------------------------------------ |
| **`0`** | Éxito                    | Check-in o tareas ejecutadas correctamente con nuevas monedas recogidas.                    |
| **`1`** | Fallo                    | Error crítico de ejecución, credenciales no válidas o fallo de autenticación.               |
| **`2`** | Sin acción / ya recogido | El check-in ya se realizó hoy y no hay tareas pendientes.                                   |
| **`3`** | Lock activo              | Otra instancia de la automatización ya se está ejecutando (evita solapamientos).            |
| **`4`** | Racha rota               | Alerta crítica: la racha de check-in se interrumpió/reinició (ayer → hoy).                  |
| **`5`** | 2FA no interactivo       | Interrupción rápida (<5 s) en cron/CI cuando AliExpress solicita 2FA (sin TTY).             |
| **`6`** | Fallo global             | Error no capturado o Promise rechazada (`uncaughtException` / `unhandledRejection`).        |
| **`7`** | Intervención manual      | Login manual necesario y no completado (ventana cerrada/timeout); sin reintento automático. |

---

## Inicio rápido (3 pasos)

### 1. Clonar el repositorio

```bash
git clone https://github.com/edlabh/ali-coins.git
cd ali-coins
```

### 2. Instalación automática

Ejecuta el instalador correspondiente a tu sistema operativo:

- **Linux (Ubuntu / Debian):** `./setup_linux.sh` (Guía detallada: [INSTALL_LINUX.es.md](INSTALL_LINUX.es.md))
- **Windows:** `setup_windows.bat` (CMD / doble clic) o `.\setup_windows.ps1` (PowerShell) (Guía detallada: [INSTALL_WINDOWS.es.md](INSTALL_WINDOWS.es.md))
- **macOS:** `./setup_macos.sh` (Guía detallada: [INSTALL_MACOS.es.md](INSTALL_MACOS.es.md))

_(El instalador comprueba Node.js >= 22, ejecuta `npm install`, descarga Chromium y prepara las credenciales)._

### 3. Configurar credenciales y ejecutar

Edita el archivo `credentials.env` con tus ajustes (permiso restringido `0o600`):

```env
ALI_USER="tu_email_o_telefono"
ALI_PASSWORD="tu_contrasena"

# Soporte multicuenta (opcional - hasta 20 cuentas secuenciales):
# ALI_USER_2="segunda_cuenta@ejemplo.com"
# ALI_PASSWORD_2="contrasena_segunda_cuenta"

# Notificación mediante webhook (Discord / Telegram / HTTP POST genérico)
# NOTIFY_WEBHOOK_URL="https://discord.com/api/webhooks/..."

# Clave para el cifrado de exportación de sesión (mínimo 32 caracteres)
# En Windows usando Node.js: node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
# En Linux/macOS: openssl rand -base64 32
SESSION_SECRET="tu_clave_secreta_con_al_menos_32_caracteres"

# Bloqueo de medios (imágenes, vídeos, fuentes) para acelerar la ejecución (predeterminado: false)
ALLOW_MEDIA=false

# Modo headless (sin ventana gráfica) (predeterminado: true)
HEADLESS=true

# Login manual opcional en ventana (predeterminado: auto)
# auto   = menú 1/2 solo cuando el login sea necesario y haya TTY + interfaz gráfica
# never  = 100 % headless (nunca pregunta ni abre ventana)
# always = abre la ventana directamente cuando el login sea necesario (sin menú)
# MANUAL_LOGIN=auto
# MANUAL_LOGIN_PROMPT_TIMEOUT_MS=60000   # timeout del menú (predeterminado: 60 s; expira en headless)
# MANUAL_LOGIN_TIMEOUT_MS=900000         # timeout de la ventana de login (predeterminado: 15 min)
# MANUAL_LOGIN_CONTEXT=desktop           # desktop (ratón/captcha) | mobile (Pixel 7)

# Nivel de log estructurado (trace, debug, info, warn, error, fatal, silent) (predeterminado: info)
LOG_LEVEL=info

# Idioma de la interfaz, logs, informes, notificaciones y scripts auxiliares
# pt-BR = portugués (predeterminado) | en = inglés
APP_LANGUAGE=pt-BR

# Ajustes opcionales de timeout y límites
# NAV_TIMEOUT=35000
# TASK_MAX_ACTIONS=25
# TASK_MAX_ATTEMPTS=4

# Seguridad de destinos externos (SSRF): webhook y heartbeat bloquean por defecto
# loopback/privados (127.0.0.1, 10.x, 192.168.x, 169.254.169.254, IPv6 ::1/fd00::/etc.).
# En pruebas locales, habilítalos explícitamente:
# ALLOW_PRIVATE_WEBHOOKS=true

# Rutina de tareas (opcional)
# SKIP_APP_ONLY_TASKS=true      # omite Prize Land/minijuegos/quizzes/reseñas (predeterminado: true)
# TASK_RETRY_UNFINISHED=false   # 2.ª pasada solo en tareas incompletas (predeterminado: false)
# TASK_RETRY_PASSES=1
# TASK_RETRY_DELAY_MS=5000
# TASK_PAUSE_MIN_MS=0           # pausa aleatoria antes de cada tarea, entre MIN y MAX en ms (predeterminado: 0/0 = desactivada)
# TASK_PAUSE_MAX_MS=0           # ej.: 15000 y 60000 -> 15 s a 60 s entre tareas (MAX >= MIN; máx. 24 h)
# ACCOUNT_DELAY_MIN_MS=0        # pausa aleatoria entre cuentas en modo multicuenta, entre MIN y MAX en ms (predeterminado: 0/0 = desactivada)
# ACCOUNT_DELAY_MAX_MS=0        # ej.: 60000 y 180000 -> 1 a 3 min entre cuentas (MAX >= MIN; máx. 24 h)
# Retraso aleatorio al inicio de la ejecución (antidetecção; predeterminado: 0/0 = desactivado)
# START_DELAY_MIN_MS=0          # espera sorteada antes de iniciar (solo en all.js real; --dry-run nunca retrasa)
# START_DELAY_MAX_MS=0          # ej.: 0 y 3540000 -> inicio en hasta ~59 min (MAX >= MIN; máx. 24 h); omítelo con --no-delay
# Nota: la tolerancia del heartbeat (dead man's switch) debe ser >= START_DELAY_MAX_MS.

# Telegram por cuenta (opcional): enviar también el resultado individual de cada cuenta (predeterminado: false)
# TELEGRAM_PER_ACCOUNT=false

# Memoria: reutilizar un único contexto desktop por cuenta eleva el pico de RAM en el host.
# Predeterminado: false (recomendado en hosts con 1 GB). Habilítalo solo con holgura de memoria.
# DESKTOP_REUSE_CONTEXT=false

# --- Opciones avanzadas (todas opcionales; mismas claves que credentials.env.example) ---
# Zona horaria de los informes (solo visualización). El "día" contable del extracto/racha es siempre
# America/Los_Angeles (zona horaria de AliExpress).
# REPORT_TIMEZONE=America/Los_Angeles

# Timeouts y ritmo
# SELECTOR_TIMEOUT=8000        # timeout de selectores (predeterminado: 8000)
# ELEMENT_TIMEOUT=4000         # timeout de elementos (predeterminado: 4000)
# NAV_TIMEOUT_SHORT=20000      # navegaciones cortas (predeterminado: 20000)
# SCROLL_WAIT_SECONDS=10       # permanencia/scroll en las tareas (predeterminado: 10)

# Lock entre ejecuciones y backoff multicuenta
# LOCK_STALE_TIMEOUT_MS=1800000   # lock considerado obsoleto tras 30 min (predeterminado)
# ACCOUNT_BACKOFF_BASE_MS=2000    # base del backoff exponencial entre cuentas (tope 30 s)

# Storage y minijuegos
# SESSION_STRICT_STORAGE=true     # allowlist estricta de localStorage (predeterminado: true)
# SURPRISE_DETAIL_FALLBACK=true   # fallback de detalle en el minijuego (predeterminado: true)

# Diagnóstico (artefactos guardados en scratch/)
# PW_OUTPUT_DIR=scratch
# PW_SCREENSHOT=only-on-failure   # off | on | only-on-failure
# PW_VIDEO=off                    # off | on | retain-on-failure | on-first-retry

# Heartbeat: la URL ya lo habilita por defecto; false lo desactiva por env
# HEARTBEAT_ENABLED=false

# Etiqueta del host mostrada en las notificaciones (predeterminado: hostname de la máquina)
# NOTIFY_HOST_LABEL=servidor-produccion-vps
```

> **Consejo multicuenta:** además de las variables `ALI_USER_2...20`, puedes crear un archivo `accounts.json` (ignorado por git) que contenga `[{"user": "...", "password": "..."}]`. Las sesiones se aíslan automáticamente por cuenta (`session_<hash>.json`) y se ejecutan secuencialmente reutilizando Chromium.
>
> **Seguridad (recomendado):** evita dejar la contraseña en texto plano en `accounts.json`. Usa `passwordEnv` (nombre de una variable de entorno) o `passwordFile` (archivo `0600`), por ejemplo: `[{"user": "a@b.com", "passwordEnv": "ALI_PW_1"}]` o `[{"user": "a@b.com", "passwordFile": "cuenta1.pw"}]`.

Valida tu configuración sin abrir el navegador:

```bash
npm start -- --dry-run
# o con salida JSON estructurada:
npm start -- --dry-run --json
```

Ejecuta el modo unificado:

- **Linux / macOS:** `./run_all.sh`
- **Windows:** `run_all.bat` o `.\run_all.ps1`

---

## Inicio de sesión manual opcional en ventana (2.0.0)

El modo predeterminado sigue siendo **100 % headless**. Cuando el login sea necesario — sin sesión válida,
sesión rechazada/reautenticación, captcha o bloqueo anti-bot — y la ejecución esté en una
terminal con interfaz gráfica, el bot ofrece un menú de dos opciones:

1. **Continuar 100 % headless** (predeterminado; `Enter` o timeout de 60 s)
2. **Abrir una ventana para el login manual**

En la opción 2, resuelves login/captcha/2FA **manualmente** en la ventana de AliExpress. El bot
detecta una cookie fuerte de autenticación (`login_aliyunid_ticket` o `xman_us_t`), guarda la
sesión, cierra la ventana y reanuda el resto de la ejecución en headless. No se elude ningún captcha.

La ventana usa por defecto un contexto **desktop** (sin emulación táctil), para que el
slider/captcha acepte el ratón. Usa `MANUAL_LOGIN_CONTEXT=mobile` si quieres reproducir la
emulación Pixel 7 del flujo móvil.

**Requisitos:** TTY interactivo e interfaz gráfica (Windows/macOS; Linux con `DISPLAY` o
`WAYLAND_DISPLAY`). En cron, Docker, CI o SSH sin display, el menú no aparece y el
comportamiento es idéntico al de la versión 1.x.

```env
MANUAL_LOGIN=auto                      # auto | never | always
MANUAL_LOGIN_PROMPT_TIMEOUT_MS=60000   # menú sin respuesta = opción 1
MANUAL_LOGIN_TIMEOUT_MS=900000         # ventana sin login = fallo (sin reintento)
MANUAL_LOGIN_CONTEXT=desktop           # desktop (predeterminado) | mobile (Pixel 7)
```

Flags equivalentes: `--manual-login` (`always`) y `--no-manual-login` (`never`).
Si se cierra la ventana o se agota el tiempo, el proceso termina con **código 7** (intervención
manual) y **no** es reintentado por `run_all.sh`. El gate/cooldown anti-bot (RGV587) solo se
limpia cuando la sesión se guarda correctamente.

> 💡 En un VPS/nube sin interfaz gráfica, realiza el login manual en tu computadora local y
> transfiere la sesión con `export_session.js` / `import_session.js` (consulta la sección de nube más abajo).

---

## Pruebas y calidad de código

El proyecto utiliza la suite de pruebas nativa de Node.js (`node:test`), Prettier y ESLint 10:

```bash
# Ejecutar la suite de pruebas unitarias y de integración
npm test

# Ejecutar la suite con informe de cobertura de código
npm run test:coverage

# Comprobar formato y linter
npm run format:check
npm run lint

# Formatear automáticamente y corregir el linter
npm run format
npm run lint:fix
```

---

## Notificaciones mediante bot de Telegram (100 % opcional)

La automatización admite el envío de estado en tiempo real (saldo actualizado, racha, monedas ganadas, tareas completadas y posibles errores) directamente a tu Telegram mediante un bot exclusivo. La funcionalidad es **100 % opcional** y permanece desactivada por defecto (`TELEGRAM_ENABLED=false`).

### Configuración paso a paso:

1. **Crear el bot en Telegram:**
   - Inicia una conversación con [@BotFather](https://t.me/BotFather) en Telegram.
   - Envía el comando `/newbot`, elige un nombre y un nombre de usuario único (ej.: `MiAliCoinsBot`).
   - Copia el **HTTP API Token** generado (formato `123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456`).
2. **Inicializar la conversación con el bot (autorización previa obligatoria):**
   - Abre el diálogo con el bot recién creado (busca `@MiAliCoinsBot` o visita `https://t.me/MiAliCoinsBot`) y pulsa **Iniciar** (`/start`).
   - _Nota de cumplimiento:_ por las políticas de privacidad de la Telegram Bot API, **los bots no tienen permiso para iniciar conversaciones con usuarios**. El envío previo del comando `/start` es indispensable para autorizar la entrega de mensajes.
3. **Obtener tu Chat ID:**
   - Inicia una conversación con [@userinfobot](https://t.me/userinfobot) en Telegram.
   - El bot responderá con tu `Id` numérico (ej.: `987654321`).
4. **Configurarlo en `credentials.env`:**

```env
TELEGRAM_ENABLED=true
TELEGRAM_BOT_TOKEN="123456789:ABCdefGHIjklMNOpqrsTUVwxyz123456"
TELEGRAM_CHAT_ID="987654321"
TELEGRAM_SILENT=false

# Para cuentas secundarias en modo multicuenta (opcional):
# TELEGRAM_CHAT_ID_2="111222333"
# O configura "telegramChatId" en cada objeto de accounts.json
```

### Cómo probar:

```bash
# Prueba directa de envío con el bot:
npm run notify:test

# Prueba con validación completa de credenciales y notificación:
npm start -- --dry-run --notify
```

Consulta el manual detallado con imágenes y solución de problemas en: [**`TELEGRAM.md`**](TELEGRAM.md) (actualmente en portugués).

---

## Ejecución en la nube (Oracle Cloud / AWS / VPS)

Los proveedores de nube tienen IPs de datacenter que AliExpress identifica como de alto riesgo, bloqueando nuevos intentos de login con Slide Captchas o códigos 2FA.

### Cómo resolverlo (delegación segura de sesión):

1. En tu **computadora personal** (conexión residencial donde el login no se challengea), ejecuta el script una vez y exporta la sesión cifrada:
   ```bash
   export SESSION_SECRET="tu_clave_secreta_con_al_menos_32_caracteres"

   # Para una sola cuenta:
   node export_session.js

   # Para todas las cuentas configuradas (multicuenta):
   node export_session.js --all

   # Para una cuenta específica:
   node export_session.js --account=2
   ```
2. En tu **servidor en la nube** (dentro de la carpeta `ali-coins`), importa la sesión mediante STDIN o archivo:

   ```bash
   export SESSION_SECRET="tu_clave_secreta_con_al_menos_32_caracteres"

   # Importar todas las cuentas a la vez:
   node import_session.js --all

   # O importar individualmente mediante STDIN:
   node import_session.js < session_token.txt
   node import_session.js < session_token_2.txt
   # o mediante archivo:
   node import_session.js --from-file=session_token_2.txt
   ```

   > ⚠️ **Aviso de seguridad:** por seguridad, el script rechaza el paso de tokens mediante la línea de comandos (`argv`), ya que expondría credenciales en el historial del shell (`history`) y en el listado de procesos del sistema (`ps aux`). El importador realiza **enrutamiento automático inteligente**, guardando la sesión de la cuenta correspondiente sin sobrescribir nunca otras cuentas.
   >
   > 🧹 **Higiene de tokens:** los archivos de token son de uso único. En la importación por lotes (`--all`) y en el modo `--from-file`, el archivo se elimina tras una importación correcta (STDIN no expone ruta y no se elimina). Usa `--keep-tokens` (o `KEEP_SESSION_TOKENS=true`) para conservarlos.
   >
   > ⏳ **Validez del token:** los tokens exportados tienen una validez estimada de ~90 días (`expiresAt`). La importación rechaza tokens vencidos por defecto; usa `--allow-expired` solo si sabes que las cookies siguen funcionando.

3. Ejecuta `./run_all.sh` en la nube. La sesión seguirá siendo válida durante semanas/meses sin requerir login.

> 💡 **Protección de Cron / ejecución no interactiva (2FA fail-fast):** en entornos sin TTY (`!process.stdin.isTTY`), si la sesión expira y AliExpress solicita verificación por código 2FA (SMS/email), el script aborta en `<5 s` con **código de salida 5** y envía una alerta de Telegram con los pasos de renovación, evitando que el programador se bloquee por un timeout de 120 s.

### Monitorear si el cron murió (Dead Man's Switch / Heartbeat)

Si tu VPS cae, el datacenter se queda sin energía o el `cron` se cuelga, **no se emite ningún log ni mensaje de error de Telegram**. Para evitar fallos silenciosos y perder la racha:

1. Crea un check gratuito en [Healthchecks.io](https://healthchecks.io) (o un monitor Push en [Uptime Kuma](https://github.com/louislam/uptime-kuma)) configurado con:
   - **Period:** `24 hours`
   - **Grace Time:** `1 hour` (alerta tras ~25 h sin ping del job).
   - Con `START_DELAY_MAX_MS > 0`, la tolerancia (**Grace Time**) debe ser **>= al techo del retraso** — el ping de inicio solo se envía tras la espera.
2. Configúralo en tu `credentials.env`:
   ```env
   HEARTBEAT_URL="https://hc-ping.com/tu-uuid-aqui"
   HEARTBEAT_TIMEOUT_MS=5000
   # HEARTBEAT_ENABLED=false   # desactiva por env (la URL ya lo habilita por defecto)
   ```
3. El script enviará automáticamente `/start` al iniciar, `/` en el éxito con el informe estructurado y `/fail` en caso de error, sin alterar nunca el código de salida original.
4. En la CLI: usa `--heartbeat` para forzarlo o `--no-heartbeat` para desactivarlo puntualmente.
5. Más detalles y solución de problemas en: [**`CLOUD_SESSIONS.es.md`**](CLOUD_SESSIONS.es.md).

---

## Ejecución mediante Docker (opcional)

Puedes ejecutar la automatización en un contenedor Docker aislado (`node:22-slim`):

```bash
docker build -t ali-coins .

# Consejo: crea los archivos de sesión en el host antes de montarlos para persistencia at-rest:
touch session.json.enc session_meta.json session.json
chmod 600 credentials.env session.json.enc session_meta.json session.json
# El contenedor se ejecuta como appuser (UID/GID 10001): si el proceso se ejecuta sin --user,
# ajusta la propiedad de los archivos montados para que appuser pueda leerlos/escribirlos:
chown 10001:10001 credentials.env session.json.enc session_meta.json session.json

docker run --rm \
  -v $(pwd)/credentials.env:/app/credentials.env:ro \
  -v $(pwd)/session.json.enc:/app/session.json.enc \
  -v $(pwd)/session_meta.json:/app/session_meta.json \
  -v $(pwd)/session.json:/app/session.json \
  -e NOTIFY_HOST_LABEL="mi-servidor" \
  ali-coins
```

- **Hosts con 1 GB de RAM (Oracle Free Tier, t2/t3.micro, DO):** recomienda 1–2 GB de swap en el host (`fallocate -l 2G /swapfile`) y limita el contenedor: `--init --pids-limit=256 --shm-size=256m --memory=768m --memory-swap=1536m`. Las flags de bajo consumo de Chromium ya se aplican por defecto tanto en Docker como fuera de él (`CHROMIUM_LOW_MEMORY=true`), `NODE_OPTIONS="--max-old-space-size=256"` evita picos de heap, `NODE_COMPILE_CACHE` acelera el arranque (caché de bytecode V8 en `/tmp`) y `SCRYPT_N=32768` reduce el pico de scrypt de ~134 MB a ~33 MB. Detalles en [`CLOUD_SESSIONS.es.md`](CLOUD_SESSIONS.es.md) y en los manuales específicos por SO ([`INSTALL_LINUX.es.md`](INSTALL_LINUX.es.md), [`INSTALL_WINDOWS.es.md`](INSTALL_WINDOWS.es.md), [`INSTALL_MACOS.es.md`](INSTALL_MACOS.es.md)).
- **Heap de Node/OOM en el flujo unificado (fuera de Docker):** los `run*.sh` detectan la RAM del host: 256 MB en máquinas pequeñas, 384 MB (3–6 GB) o 512 MB (más de 6 GB). Esto evita el `JavaScript heap out of memory` del check-in + tareas en un único proceso. Para forzar un techo, usa `ALI_HEAP_MB=512 ./run_all.sh`; un `NODE_OPTIONS` exportado tiene precedencia. Dentro del contenedor el techo sigue siendo 256 MB por el límite de `memory: 768M`; si vas a ejecutar el flujo unificado en contenedor con más tareas, aumenta `NODE_OPTIONS` y el límite de memoria juntos.
- **Usuario no root:** el contenedor se ejecuta por defecto como el usuario de sistema dedicado `appuser` (UID/GID 10001).
- **Ejecución con `--user <uid>:<gid>` del host:** si especificas el usuario del host para mantener los permisos de los archivos montados, monta `/etc/passwd` y `/etc/group` en modo de solo lectura para que la resolución de usuario de Node (`os.userInfo()` mediante libuv `uv_os_get_passwd`) no genere un error `ENOENT`:
  ```bash
  docker run --rm \
    -u $(id -u):$(id -g) \
    -v /etc/passwd:/etc/passwd:ro \
    -v /etc/group:/etc/group:ro \
    -v $(pwd)/credentials.env:/app/credentials.env:ro \
    -v $(pwd)/session.json.enc:/app/session.json.enc \
    -v $(pwd)/session_meta.json:/app/session_meta.json \
    -v $(pwd)/session.json:/app/session.json \
    -e NOTIFY_HOST_LABEL="mi-servidor" \
    ali-coins
  ```
- **Compose y wrapper de producción:** usa `docker-run.example.sh` (wrapper de cron con medición de pico de memoria/PIDs) o `docker-compose.yml` (límites declarativos: `shm_size: 256m`, tmpfs `/tmp`, `cap_drop: ALL`, `no-new-privileges`, memoria 768M) para no repetir las flags manualmente.
- **Persistencia at-rest (`session.json.enc`):** con `ENCRYPT_LOCAL_SESSION=true` (predeterminado desde 0.8), AliExpress guarda la sesión cifrada en `session.json.enc` y los metadatos en `session_meta.json`. El montaje de estos archivos garantiza que la sesión persista entre ejecuciones del contenedor efímero (`--rm`).
- **Identificación del host en Telegram (`NOTIFY_HOST_LABEL`):** en contenedores desechables, el hostname predeterminado es el ID aleatorio del contenedor. Pasa `-e NOTIFY_HOST_LABEL="mi-servidor"` o la flag `--hostname mi-servidor` para que las notificaciones identifiquen correctamente tu servidor.
- La variable `PLAYWRIGHT_BROWSERS_PATH=/ms-playwright` garantiza el uso compartido y la caché de los navegadores.

---

## Seguridad y permisos

- **Cifrado at-rest (`session.json.enc`):** las sesiones locales se guardan cifradas con AES-256-GCM v3 (`scrypt` + salt aleatorio) cuando `SESSION_SECRET` está configurado (`ENCRYPT_LOCAL_SESSION=true`). Incluye lectura transparente con fallback para migrar `session.json` heredado, migración automática de tokens `v1`/`v2` a `v3` y rotación suave de claves mediante `SESSION_SECRET_OLD`.
- **Rotación de claves de sesión:** la rotación at-rest puede ejecutarse manualmente mediante la CLI:
  ```bash
  export SESSION_SECRET_OLD="clave_antigua_con_mas_de_32_chars"
  export SESSION_SECRET_NEW="nueva_clave_secreta_con_mas_de_32_chars"
  node export_session.js --rotate --new-secret-from-env=SESSION_SECRET_NEW
  ```
  La sesión anterior se descifra con `SESSION_SECRET_OLD`, se valida, se guarda como backup seguro en `scratch/session.bak-<timestamp>.json.enc` (0o600) y se vuelve a cifrar con la nueva clave.
- **Política de retención de backups (`scratch/`):** limpieza automática (`pruneSessionBackups`) de backups con antigüedad superior a `SESSION_BACKUP_RETENTION_DAYS` (predeterminado: 7 días), activada durante la rotación, el guardado o la limpieza de sesiones.
- **Permisos 0o600 estrictos:** todos los archivos de secretos (`credentials.env`, `session.json`, `session.json.enc`, `session_meta.json`, `session_token.txt`, backups y dumps) se guardan y mantienen exclusivamente con permiso `0o600`.
- **Cifrado AES-256-GCM v3:** las exportaciones y el reposo usan derivación de clave mediante `scrypt` con salt aleatorio dinámico de 16 bytes, parámetros explícitos y `SESSION_SECRET` (mínimo 32 caracteres). Compatible con tokens heredados `v1` y `v2`.
- **Pinning de DNS (anti-SSRF/rebinding):** los webhooks y el heartbeat revalidan **cada salto** de redirección y la conexión usa la **IP validada** (lookup fijado mediante `undici`) — un DNS con TTL 0 no puede devolver una IP pública en la comprobación y una privada/metadata en la conexión. Sin `undici` instalado, se mantiene la validación DNS tradicional (degradación elegante).
- **Aislamiento del navegador:** la flag `--no-sandbox` de Chromium está restringida exclusivamente a la ejecución como root (UID 0) o CI, manteniendo la sandbox activada para usuarios normales.
- **Redacción de logs:** los logs estructurados mediante `pino` redactan automáticamente contraseñas, tokens, cookies y parámetros de URL sensibles.

---

## Protección de la rama e integración continua (CI)

- **Validación obligatoria:** la rama `main` exige que todas las pruebas en Linux, macOS y Windows, así como la comprobación de formato y linter, pasen correctamente en el workflow `CI` antes de cualquier merge.
- **Gate de supply-chain en Dependabot:** los PRs automatizados de dependencias (patch/minor) cuentan con un gate de seguridad que espera la finalización correcta del workflow `CI` en el SHA del commit antes de autorizar el auto-merge (`squash`).
