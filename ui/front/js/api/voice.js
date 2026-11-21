import { http } from './client.js';

export const voiceApi = {
  communications: () => http.get('/communications'),
  conversations: () => http.get('/conversations'),
  conversation: id => http.get(`/conversations/${encodeURIComponent(id)}`),
  start: (id, person_id) => http.post(`/communications/${encodeURIComponent(id)}/start`, { audio: true, ...(person_id ? { person_id } : {}) }),
  turn: (id, input) => http.post(`/conversations/${encodeURIComponent(id)}/turns`, { ...input, request_id: crypto.randomUUID(), audio: true }),
  finish: id => http.post(`/conversations/${encodeURIComponent(id)}/finish`, {}),
  // Bearer-authenticated fetch is essential when different demo tabs use different sessions.
  audio: id => http.get(`/audio/${encodeURIComponent(id)}`, { responseType: 'blob' }),
};

export async function microphoneRecording() {
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) throw new Error('Este navegador no permite grabar. Usa el texto o abre localhost en Chrome.');
  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const mime = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/ogg;codecs=opus'].find(type => MediaRecorder.isTypeSupported(type));
  const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : {});
  const chunks = []; let timer; let cancelled = false;
  const release = () => { clearTimeout(timer); stream.getTracks().forEach(track => track.stop()); };
  const result = new Promise((resolve, reject) => {
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onerror = () => { release(); reject(new Error('No se pudo grabar el micrófono.')); };
    recorder.onstop = async () => {
      release(); if (cancelled) { resolve(null); return; }
      const blob = new Blob(chunks, { type: recorder.mimeType || mime || 'audio/webm' });
      if (!blob.size || blob.size > 10 * 1024 * 1024) { reject(new Error('Graba una respuesta de menos de un minuto y 10 MB.')); return; }
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('No se pudo leer la grabación.'));
      reader.onload = () => resolve({ audio_base64: String(reader.result).split(',')[1], mime: blob.type });
      reader.readAsDataURL(blob);
    };
  });
  recorder.start(); timer = setTimeout(() => { if (recorder.state === 'recording') recorder.stop(); }, 60000);
  return { result, stop: () => { if (recorder.state === 'recording') recorder.stop(); },
    cancel: () => { cancelled = true; if (recorder.state === 'recording') recorder.stop(); else release(); } };
}
