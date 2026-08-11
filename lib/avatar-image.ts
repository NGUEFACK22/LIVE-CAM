/**
 * Prépare une image d'avatar pour l'envoi au SDK Decart (set_image).
 *
 * Les avatars téléversés peuvent peser jusqu'à 15 Mo. Le SDK les envoie en
 * base64 à travers la WebSocket de signalisation (message `set_image`).
 * Un message trop gros est rejeté SILENCIEUSEMENT par le serveur : le modèle
 * n'a alors aucune image de référence et renvoie un flux noir.
 *
 * Ici on redimensionne (max 1024 px de large) et on compresse en JPEG
 * (qualité 0.85) : on passe de plusieurs Mo à quelques centaines de Ko,
 * largement sous la limite du WebSocket.
 */

export const AVATAR_MAX_DIMENSION = 1024
export const AVATAR_JPEG_QUALITY = 0.85

/**
 * Redimensionne + compresse un Blob image en un Blob JPEG prêt à envoyer.
 * Renvoie le blob d'origine si le traitement échoue (sans jamais bloquer).
 */
export async function prepareAvatarImage(input: Blob): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(input)
    try {
      const scale = Math.min(1, AVATAR_MAX_DIMENSION / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))

      // Toujours re-encoder en JPEG même sans redimensionnement : ça permet de
      // convertir un PNG/WebP volumineux en JPEG léger (la base64 devient
      // ~33% plus petite que le JPEG d'origine).
      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) return input

      ctx.drawImage(bitmap, 0, 0, width, height)
      const dataUrl = canvas.toDataURL('image/jpeg', AVATAR_JPEG_QUALITY)
      const base64 = dataUrl.split(',')[1]
      if (!base64) return input

      const binary = atob(base64)
      const bytes = new Uint8Array(binary.length)
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
      const jpeg = new Blob([bytes], { type: 'image/jpeg' })

      console.log(
        `[Avatar] Préparé: ${(input.size / 1024).toFixed(0)} Ko -> ${(jpeg.size / 1024).toFixed(0)} Ko ` +
          `(${width}x${height})`,
      )
      return jpeg
    } finally {
      bitmap.close()
    }
  } catch (err) {
    console.warn('[Avatar] Échec préparation image (envoi original):', err)
    return input
  }
}
