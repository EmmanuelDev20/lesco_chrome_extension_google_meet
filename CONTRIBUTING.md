# Cómo contribuir a LESCO Translator

¡Gracias por tu interés! Este proyecto busca hacer las videollamadas más accesibles para la comunidad sorda de Costa Rica.

## Formas de contribuir

### 🐛 Reportar un bug
Abre un [Issue](https://github.com/EmmanuelDev20/lesco_chrome_extension_google_meet/issues/new) describiendo:
- Qué esperabas que pasara
- Qué pasó en realidad
- Pasos para reproducirlo
- Versión de Chrome y sistema operativo

### 💡 Sugerir una mejora
Abre un Issue con la etiqueta `enhancement` explicando el caso de uso y por qué sería útil.

### 🔧 Enviar código (Pull Request)

1. **Fork** del repositorio
2. Crea una rama descriptiva:
   ```bash
   git checkout -b mejora/glosa-verbos-irregulares
   # o
   git checkout -b fix/panel-no-se-muestra-en-meet
   ```
3. Haz tus cambios y comitea con mensajes claros en español o inglés
4. Asegúrate de que la extensión sigue funcionando en Google Meet
5. Abre un Pull Request describiendo qué cambiaste y por qué

### 🧠 Mejorar las reglas de glosa
El archivo principal es `content.js`. Las reglas de conversión español → glosa LESCO están en:
- `DROP_WORDS` — palabras que se eliminan (artículos, preposiciones, conjunciones)
- `VERB_MAP` — verbos irregulares → infinitivo
- `TIME_WORDS` — palabras que van al inicio de la frase
- `verbToInfinitive()` — reglas de sufijos para verbos regulares
- `spanishToGloss()` — función principal de conversión

Si conoces LESCO y encuentras que alguna traducción es incorrecta, ¡ese es el lugar para mejorarla!

## Estilo de código

- JavaScript moderno (ES2020+), sin frameworks ni bundlers
- Comentarios en español
- Nombres de variables y funciones en inglés (camelCase)
- Sin dependencias externas en la extensión

## Repositorio remoto

El repositorio ya tiene configurado el remote `origin`:
```
git@github.com:EmmanuelDev20/lesco_chrome_extension_google_meet.git
```

## Preguntas

Abre un Issue con la etiqueta `question` o escríbeme directamente.
