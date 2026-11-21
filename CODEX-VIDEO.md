# Encargo para Codex: grabar, montar y entregar el vídeo de la demo

Eres responsable de producir **un único archivo de vídeo de 2:00–2:45** de la demo, en inglés, y dejarlo en
`/Users/paulasantaballalison/Desktop/Toni/entrega/sherpas-demo.mp4` (o `.mov`). Mira la hora al empezar (`TZ=Europe/Madrid date`): la entrega oficial era a las 16:45. Si no llegas a un montaje completo, entrega la **versión mínima** descrita al final antes que nada.

## Contexto (ya hecho, no lo rehagas)

- Repo: `/Users/paulasantaballalison/Desktop/Toni/proyecto/CDTM_VLC_HACKS26`, rama `codex/local-setup`. Lee `DEMO.md` (runbook completo) antes de tocar nada.
- Servidor local en `http://127.0.0.1:3000`, sobre `var/demo.sqlite3`. Estado inicial ya preparado: noticia simulada de matrículas evaluada para las 4 familias + petición de Samantha **pendiente de aprobación** en modo MANUAL.
- Reinicio del estado en 5 s: `./scripts/demo-restore.sh` (después hay que recargar las pestañas).
- No cambies código de producto, no hagas push, no toques `feat/ui-front`. Las claves están en `.env`: no las imprimas, no las muestres en pantalla ni en el vídeo.
- Clip de voz humana de la clienta (grabado por Toni): `/Users/paulasantaballalison/Desktop/Toni/entrega/samantha.m4a`. Si no existe, pídeselo; no lo sustituyas por voz sintética sin decirlo. Comprobado a las 16:30: existe, dura 11,8 s (AAC mono 48 kHz) y el servidor lo transcribe bien con `mime: audio/mp4`, salvo que ElevenLabs STT escribe "Abbas College" en lugar de "Ava's college". Es un error real de transcripción: no edites la transcripción ni lo ocultes; si Toni deja un clip nuevo con el mismo nombre, usa ese.

## Herramientas disponibles en este Mac

- `screencapture -v` (vídeo de pantalla; necesita permiso de Grabación de pantalla para tu app: si la captura sale solo con el fondo de escritorio, pide a Toni que lo active en Ajustes del Sistema → Privacidad y seguridad → Grabación de pantalla, o graba con `Cmd+Shift+5`).
- `brew` está instalado; **ffmpeg no**. Opciones de montaje, por orden: `brew install ffmpeg`; si tarda más de 3 min, un script Swift con AVFoundation (`AVMutableComposition`, `swift` está instalado); último recurso: versión mínima.
- `afplay`, `afconvert`, `avconvert`. Safari es el único navegador.

## Paso 1 — Narración con ElevenLabs (4 clips)

Genera 4 mp3 en `Toni/entrega/audio/` con `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, cabecera `xi-api-key` (de `ELEVENLABS_API_KEY`), cuerpo `{"text": "...", "model_id": "<ELEVENLABS_TTS_MODEL>"}`. Usa una voz **distinta** de `ELEVENLABS_VOICE_ID` (esa es la del asistente; lista voces con `GET /v1/voices`), para que narrador y asistente no se confundan.

Texto exacto:

- `n1.mp3`: "Financial advisors can't watch every headline for every family. Here, a tuition headline comes in. The system checks all four families on its own. Two get no contact. Two will wait for their next review. Each decision has a written reason. Most of the time, the right answer is silence."
- `n2.mp3`: "Then Samantha asks for a short call about her daughter Ava's college plan. In manual mode, nothing goes out without the advisor. The agent has prepared the script, the likely questions, and the limits of what it may say. One click approves it."
- `n3.mp3`: "Samantha talks to the assistant in her browser. The voice is ElevenLabs. Her words are transcribed and kept as evidence."
- `n4.mp3`: "The call is over, but the work isn't. The system kept what she said in her own words, her preference for short explanations, and scheduled the follow-up she asked for. When it's due, it re-evaluates before contacting her. Sherpas: first to know, first to tell, thoughtfully."

## Paso 2 — Clips de pantalla en Safari (ventana a pantalla completa, zoom 110–125 %)

Antes: `./scripts/demo-restore.sh`. Cierra notificaciones y otras ventanas. Graba cada clip por separado.

**Clip A — Proceso (≈25 s).** URL `http://127.0.0.1:3000/ops`.
1. Espera 2 s con la cabecera y los 4 contadores visibles.
2. Desplázate despacio hasta que el bloque "Events and family decisions" muestre el evento "Public news · All families screened · Simulated event" con las 4 tarjetas (Michael Carter "No contact", Timothy Melanie Weah "No contact", Daniel Emily Johnson "Wait · revisit later", Samantha Lewis "Wait · revisit later").
3. Mantén 6 s para que se lean los motivos.

**Clip B — Asesor aprueba (≈30 s).** URL `http://127.0.0.1:3000/app/?role=consultor#/alertas`.
1. Espera 2 s en la lista con la fila "Samantha Lewis · Revisión pendiente".
2. Clic en **Revisar**.
3. Espera 3 s en la cabecera (pasos 1–4, "Paso 3: Revisión y canal").
4. Desplázate hasta ver "Canal 2: Conversación con asistente virtual" y el guion de voz; mantén 4 s.
5. Abre el desplegable "Objetivos, preguntas previstas y límites"; mantén 4 s.
6. Clic en **Preparar llamada en navegador** (botón azul oscuro). Espera a que la cabecera pase a "Paso 4: Conversación en navegador".

**Clip C — Clienta (≈50 s).** URL `http://127.0.0.1:3000/app/?role=cliente&family=samantha-lewis#/mi-plan` (recarga).
1. Arriba a la derecha, tarjeta "Conversar con el asistente virtual": debe decir "Conversación abierta" y mostrar la frase inicial del asistente y un reproductor.
2. Pulsa **play** en el reproductor y deja sonar la frase inicial completa.
3. **Sin usar el micrófono**, envía el clip humano por la API (ver Paso 3). La vista sondea sola: en pocos segundos aparecen la burbuja "Tú" con la transcripción y la respuesta del asistente.
4. Mantén 6 s con ambas burbujas visibles.
5. Clic en **Terminar**. Debe aparecer "Conversación finalizada. El análisis y los seguimientos se procesarán ahora."

**Clip D — Aprendizaje y seguimiento (≈35 s).** URL `http://127.0.0.1:3000/ops?family=samantha-lewis`.
1. Espera hasta que el primer evento muestre la etiqueta "Conversation completed" y en "Work in motion" aparezca "Relationship Analysis · completed" (≈25 s reales; se puede cortar en montaje).
2. Mantén 5 s en "Next thoughtful touch" (seguimiento a ~5 días sobre los costes de Ava).
3. Desplázate hasta "Relationship memory" (etiquetas "Said by the client" y "Preference confirmed by the client", con cita literal); mantén 6 s.

## Paso 3 — Turno de voz humana por API (durante el Clip C)

Con sesión de cliente (`POST /api/session {"role":"client","family_id":"samantha-lewis"}` → `token`, usar `Authorization: Bearer`):
1. `GET /api/conversations` → la conversación con `state:"active"`; guarda su `id`. El audio de apertura está en `turns[0].audio.audio_id` → `GET /api/audio/<id>` → guarda `opening.mp3`.
2. `POST /api/conversations/<id>/turns` con `{"audio_base64":"<samantha.m4a en base64>","mime":"audio/mp4","audio":true,"request_id":"video-1"}`. Devuelve la transcripción (ElevenLabs STT) y `reply` con `audio.audio_id` → descárgalo como `reply.mp3`.
3. Tras el clic en Terminar (o `POST /api/conversations/<id>/finish`), sondea `GET /api/conversations/<id>` hasta `analysis_state:"completed"` y anota `acoustic_status` (análisis de tono de Gemini sobre el audio humano).

Frase que dice la clienta en `samantha.m4a`:
"It was about tuition in general. Honestly, I'm worried about paying for Ava's college. Please keep your explanations short, and could you follow up with me in five days?"

## Paso 4 — Montaje

Orden: A + n1 → B + n2 → C + (n3 breve al inicio, luego `opening.mp3`, luego `samantha.m4a`, luego `reply.mp3`) → D + n4. Ajusta la duración de cada clip a su audio (congela el último fotograma si falta; corta esperas). 1080p, texto legible, sin terminales ni claves. Duración total ≤ 2:45.

## Reglas de honestidad

- No presentes los cortes como medición continua de velocidad.
- El evento de la noticia es simulado y así aparece etiquetado; no lo ocultes.
- La voz de la clienta es un clip humano real enviado por la API (no por el botón del micrófono, porque la pantalla está automatizada). Anótalo en `DEMO.md`.
- No inventes métricas, emociones ni resultados. Si `acoustic_status` no es `available`, no digas que hubo análisis de tono.

## Verificación y cierre

Reproduce el vídeo entero: audio audible, sin secretos, sin notificaciones, duración correcta. Añade a `DEMO.md` una sección "Video" con cómo se grabó, qué se cortó y el `acoustic_status` real. Commit local en `codex/local-setup` (sin push salvo que Toni lo pida).

## Versión mínima (si el tiempo no da)

Una sola toma continua de pantalla (A → B → C → D) con `Cmd+Shift+5` y micrófono activado, reproduciendo por los altavoces con `afplay` los clips n1–n4 y `samantha.m4a` en su momento, y el audio del asistente desde el navegador. Sin montaje.
