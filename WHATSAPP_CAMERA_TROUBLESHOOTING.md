# Guide de dépannage : WhatsApp Desktop montre toujours la caméra native

**Problème :** Malgré ChapCam en cours d'exécution avec Live Swap actif, 
WhatsApp Desktop affigue toujours votre webcam physique au lieu de la 
OBS Virtual Camera.

## Causes fréquentes et solutions

### 1. La scène OBS n'est pas sélectionnée
**Symptôme :** WhatsApp → Settings → Devices → Camera montre votre webcam native
**Solution :**
1. Ouvrez OBS Studio
2. En haut à droite, vérifiez que la scène sélectionnée est bien **"ChapCam"** 
   (et non "ChapCam (2)" ou une autre scène)
3. La petite icône de scène doit être mise en surbrillance (bleu)

### 2. La OBS Virtual Camera n'est pas démarrée
**Symptôme :** L'option "OBS Virtual Camera" n'apparait pas ou est grise dans WhatsApp
**Solution :**
1. En bas à droite d'OBS, cherchez le bouton **Start Virtual Camera**
2. Il doit avoir une icône **verte** et afficher "Virtual Camera activée"
3. Si le bouton affiche "Start", cliquez dessus pour la démarrer
4. Attendez quelques secondes qu'elle se initialise

### 3. Plusieurs appareils photo détectés par WhatsApp
**Symptôme :** WhatsApp montre plein d'options (Intel RealSense, Integrated Camera, etc.)
**Solution :**
Dans WhatsApp Desktop → Settings → Devices → Camera, essayez chaque option :
- **Celle qui donne un flux vidéo en direct** (même un peu floue ou en noir et blanc) est la bonne
- Celles qui montrent "Aucune caméra" ou qui restent grises ne le sont pas
- Sélectionnez celle qui contient votre visage (même avec un petit délai)

### 4. Confidentialité Windows bloque l'accès
**Symptème :** WhatsApp ne peut pas accéder à la caméra virtuelle
**Solution Windows 11 :**
1. Cliquez sur le menu Démarrer → **Paramètres** (ou `Windows + I`)
2. Allez dans **Confidentialité et sécurité** → **Accès à la caméra**
3. Faites défiler jusqu'à **Applications qui peuvent accéder à votre caméra**
4. Assurez-vous que **WhatsApp** est activé (basculé sur "Activé")
5. Si vous voyez une entrée **OBS Studio** ou **OBS Virtual Camera**, activez-la aussi

### 5. Redémarrage complet requis
**Solution :**
1. Fermez complètement ChapCam Desktop (clic droit → Quitter)
2. Fermez complètement WhatsApp Desktop (clic droit → Quitter, pas juste minimiser)
3. Fermez OBS Studio
4. Attendez 10 secondes
5. Relancez dans cet ordre :
   - OBS Studio (lancer en premier)
   - Cliquer sur "Start Virtual Camera" en bas à droite
   - ChapCam Desktop (cliquer sur "Démarrer le Live Swap")
   - WhatsApp Desktop
6. Allez dans Settings → Devices → Camera → Sélectionnez "OBS Virtual Camera"

### 5. Le script de démarrage automatique
**Utilisez les fichiers créés :**
- Double-cliquez sur `start-chapcam-desktop.bat` pour configurer automatiquement
- Ou exécutez `start-chapcam-desktop.ps1` en PowerShell (avec droits d'administration)

Le script va :
1. Vérifier si Next.js tourne sur le port 3000
2. Le démarrer s'il n'est pas actif
3. Lancer OBS Studio s'il n'est pas ouvert
4. Vous guider pas à pas pour créer la scène "ChapCam"
5. Vous rappeler de démarrer la OBS Virtual Camera
6. Ouvrir ChapCam sur la page Live Swap

## Problème : Message d'erreur "Impossible d'ouvrir la connexion temps réel"

Si vous voyez ce message dans ChapCam :
1. Vérifiez que OBS est bien ouvert et la scène "ChapCam" est sélectionnée
2. Vérifiez que la OBS Virtual Camera est démarrée (icône verte en bas à droite)
3. Dans ChapCam, essayez de cliquer sur le bouton **Stream Mode** (icône TV)
   - Cela force le mode capture OBS purement
4. Redémarrez ChapCam complètement

## Résolution rapide (tout en un)

Si rien d'autre ne fonctionne, exécutez cette séquence dans l'ordre :

```
1. OBS Studio → Scène "ChapCam" → Start Virtual Camera (icône verte)
2. ChapCam Desktop → "Démarrer le Live Swap" 
3. WhatsApp Desktop → Settings → Devices → Camera → "OBS Virtual Camera"
4. Appelez quelqu'un → Vous devriez voir votre visage AI swapé !
```

---

**Note importante :** Le premier lancement peut prendre 2-3 minutes pendant que 
OBS initialise la scène et la caméra virtuelle. Soyez patient et suivez les 
étapes ci-dessus dans l'ordre.

**Fichiers fournis :**
- `start-chapcam-desktop.bat` - Script de configuration automatique
- `start-chapcam-desktop.ps1` - Version PowerShell complète
- `WHATSAPP_CAMERA_TROUBLESHOOTING.md` - Ce guide