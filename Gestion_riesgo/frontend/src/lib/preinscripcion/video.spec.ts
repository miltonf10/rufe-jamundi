// Qué formato de video elige cada teléfono.
//
// Esto decide si alguien puede grabar o no, y se equivoca en silencio: un fallo
// aquí no da error, simplemente le dice a media ciudad «este teléfono no permite
// grabar» teniendo la cámara disponible.
//
// El caso que más importa es Safari. WebKit solo graba MP4 con H.264 y AAC —no
// soporta WebM en absoluto (webkit.org/blog/11353/mediarecorder-api/)—, así que
// si MP4 desapareciera de la lista, ningún iPhone podría grabar.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { formatoSoportado, mimeBase } from './video';

/** Suplanta MediaRecorder con uno que solo admite los formatos indicados. */
function conSoporte(formatos: string[]) {
	vi.stubGlobal('MediaRecorder', {
		isTypeSupported: (t: string) => formatos.includes(t)
	});
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('formatoSoportado', () => {
	it('prefiere VP9 cuando el teléfono lo tiene', () => {
		// Comprime bastante mejor que VP8, y en una vereda cada megabyte son
		// segundos de subida.
		conSoporte(['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm']);

		expect(formatoSoportado()).toBe('video/webm;codecs=vp9');
	});

	it('baja a VP8 si no hay VP9', () => {
		conSoporte(['video/webm;codecs=vp8', 'video/webm']);

		expect(formatoSoportado()).toBe('video/webm;codecs=vp8');
	});

	it('en un iPhone elige MP4, que es lo único que Safari graba', () => {
		// Safari no soporta WebM. Sin MP4 en la lista, ningún iPhone grabaría.
		conSoporte(['video/mp4']);

		expect(formatoSoportado()).toBe('video/mp4');
	});

	it('acepta el MP4 con codecs declarados', () => {
		conSoporte(['video/mp4;codecs=avc1']);

		expect(formatoSoportado()).toBe('video/mp4;codecs=avc1');
	});

	it('con MediaRecorder pero SIN isTypeSupported, da por bueno MP4', () => {
		// Hay versiones de Safari así. Es la salida que documenta el propio
		// WebKit; sin ella, esos teléfonos quedarían fuera sin motivo.
		vi.stubGlobal('MediaRecorder', {});

		expect(formatoSoportado()).toBe('video/mp4');
	});

	it('sin MediaRecorder devuelve null, y el formulario lo dice', () => {
		vi.stubGlobal('MediaRecorder', undefined);

		expect(formatoSoportado()).toBeNull();
	});

	it('un navegador que no admite nada devuelve null', () => {
		conSoporte([]);

		expect(formatoSoportado()).toBeNull();
	});
});

describe('mimeBase', () => {
	it('quita los códecs, que es lo que entiende el servidor', () => {
		// El servidor compara contra `video/webm` y `video/mp4` exactos. Mandarle
		// la cadena con `;codecs=…` haría que rechazara todos los videos.
		expect(mimeBase('video/webm;codecs=vp9')).toBe('video/webm');
		expect(mimeBase('video/mp4;codecs=avc1')).toBe('video/mp4');
	});

	it('deja intacto lo que ya viene limpio', () => {
		expect(mimeBase('video/mp4')).toBe('video/mp4');
	});
});
