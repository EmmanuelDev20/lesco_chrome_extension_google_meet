# 🤟 LESCO Translator — Extensión de Chrome para Google Meet

Extensión de Chrome que traduce los subtítulos de Google Meet a **Lengua de Señas Costarricense (LESCO)** en tiempo real, mostrando los videos de señas directamente sobre la reunión.

> **¿Por qué?** Costa Rica tiene más de 30,000 personas sordas. Esta herramienta busca hacer las videollamadas más accesibles sin depender de intérpretes en tiempo real.

---

## Capturas de pantalla

<!-- Agrega imágenes aquí cuando las tengas -->
_Próximamente_

---

## Características

- 🎥 **Reproducción secuencial** — los videos de señas se reproducen uno por uno siguiendo el hilo de la conversación
- 🧠 **Conversión a glosa LESCO** — no traduce literalmente: convierte el español a la estructura gramatical de LESCO (elimina artículos, normaliza verbos, reordena expresiones de tiempo)
- ✍️ **Deletreo dactilológico** — las palabras sin seña disponible se deletrean letra por letra con el abecedario manual
- ⏩ **Modo EN VIVO / historial** — navega frases anteriores con ◀ ▶ y vuelve al directo con un clic
- 💾 **Caché de videos** — los videos se almacenan en disco después del primer uso; las palabras comunes se pre-descargan al instalar
- 📋 **Historial de sesiones** — cada reunión se guarda con su transcripción y se puede revisar desde el popup de la extensión, incluyendo la reproducción de señas

---

## Instalación

### Requisitos
- Google Chrome (o cualquier navegador basado en Chromium)
- Python 3.8+ (solo para generar el diccionario)

### Paso 1 — Generar el diccionario LESCO

El diccionario **no está incluido** en el repositorio porque los videos y el contenido son propiedad del CENAREC. Debes generarlo tú mismo corriendo el scraper:

```bash
cd scraper
pip install -r requirements.txt
python scraper.py
```

Esto crea el archivo `data/lesco_dictionary.json` con ~1100 palabras y sus URLs de video. Tarda unos 10-15 minutos.

### Paso 2 — Cargar la extensión en Chrome

1. Abre Chrome y ve a `chrome://extensions`
2. Activa **"Modo desarrollador"** (esquina superior derecha)
3. Clic en **"Cargar descomprimida"**
4. Selecciona la carpeta `extension_lesco/`

La extensión aparecerá con el ícono 🤟 en la barra de Chrome.

---

## Uso

1. Entra a una reunión en [Google Meet](https://meet.google.com)
2. Activa los subtítulos con el botón **CC** en la barra inferior
3. El panel LESCO aparecerá automáticamente en la esquina inferior derecha
4. Los videos de señas se reproducen en tiempo real mientras la gente habla

### Panel de señas
- **◀ ▶** — navegar entre palabras de la frase actual
- **● EN VIVO** — indica que estás en el modo en tiempo real
- **⏩ IR AL VIVO** — aparece cuando revisas frases pasadas; vuelve al directo
- Los chips de palabras en la barra inferior son clickeables para saltar a cualquier seña

### Historial de sesiones
- Haz clic en el ícono de la extensión en la barra de Chrome
- Cada sesión (reunión) muestra fecha, duración y frases
- Clic en **▶** junto a una frase para ver sus señas en video

---

## Arquitectura

```
extension_lesco/
├── manifest.json       # Configuración de la extensión (Manifest V3)
├── content.js          # Lógica principal: captions → glosa → señas
├── overlay.css         # Estilos del panel flotante
├── background.js       # Service worker (pre-caché al instalar)
├── popup.html          # UI del historial de sesiones
├── popup.js            # Lógica del historial y mini player
├── icons/              # Íconos de la extensión
└── data/
    └── lesco_dictionary.json   # Generado por el scraper (no incluido)

scraper/
├── scraper.py          # Genera lesco_dictionary.json desde CENAREC
├── inspect_page.py     # Diagnóstico de una página individual
└── requirements.txt    # Dependencias Python
```

### Pipeline de traducción

```
Subtítulos (español)
        ↓
spanishToGloss()     — elimina artículos/preposiciones, normaliza verbos,
                        mueve expresiones de tiempo al frente
        ↓
Glosa LESCO          — tokens en forma base, orden gramatical de señas
        ↓
findInDictionary()   — busca cada token en lesco_dictionary.json
        ↓
Cola de reproducción — señas con video + letras deletreadas para lo demás
        ↓
Cache API            — primer uso: descarga y cachea; usos siguientes: instantáneo
```

---

## Cómo contribuir

¡Las contribuciones son bienvenidas! Lee [CONTRIBUTING.md](CONTRIBUTING.md) para los detalles.

Áreas donde se necesita ayuda:

- **Mejoras a la glosa** — el motor de conversión español→LESCO es básico; un hablante nativo de LESCO podría mejorar mucho las reglas
- **Soporte para más plataformas** — Microsoft Teams, Zoom, Jitsi
- **Detección automática de captions** — sin depender de selectores CSS hardcodeados
- **Más palabras en el diccionario** — el scraper cubre ~1100 palabras; hay señas fuera del diccionario web
- **Pruebas** — no hay tests automatizados todavía

---

## Licencia

Este proyecto está bajo la licencia **CC BY-NC-SA 4.0** (Creative Commons Attribution-NonCommercial-ShareAlike). Ver [LICENSE.md](LICENSE.md) para más detalles.

Puedes usar, modificar y distribuir este proyecto libremente siempre que: des crédito al autor original, no lo uses con fines comerciales, y distribuyas tus adaptaciones bajo la misma licencia.

Los videos del diccionario LESCO son propiedad del **CENAREC** y están bajo la misma licencia [CC BY-NC-SA](https://creativecommons.org/licenses/by-nc-sa/4.0/). Esta extensión los enlaza directamente desde su servidor; no los redistribuye.

---

## Créditos

- Diccionario LESCO: [CENAREC — Centro Nacional de Recursos para la Educación Inclusiva](https://lesco.cenarec.go.cr)
- Desarrollado por [Emmanuel Ovares](https://github.com/EmmanuelDev20)

---

## Links

- [Reportar un bug](https://github.com/EmmanuelDev20/lesco_chrome_extension_google_meet/issues/new?template=bug_report.md)
- [Sugerir una mejora](https://github.com/EmmanuelDev20/lesco_chrome_extension_google_meet/issues/new?template=feature_request.md)
- [Diccionario LESCO (CENAREC)](https://lesco.cenarec.go.cr)
