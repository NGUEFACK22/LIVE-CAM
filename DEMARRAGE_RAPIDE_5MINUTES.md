# ⚡ SETUP PARFAIT CHAPCAM - DÉMARRAGE EN 5 MINUTES

## Objectif : Avoir le Live Swap IA qui fonctionne sur WhatsApp Desktop

## Prérequis :
- Windows 11
- ChapCam Desktop installé
- OBS Studio installé

## Étapes (chronométré) :

### **Minute 0-1 : Exécuter le setup**
1. Double-cliquez sur **START_PARFAIT.ps1** (PowerShell)
   - Ou exécutez : `PowerShell -ExecutionPolicy Bypass -File .\START_PARFAIT.ps1`
2. Le script va :
   - Vérifier votre configuration .env.local ✓
   - Démarrer le serveur Next.js automatiquement ✓
   - Lancer OBS Studio s'il n'est pas ouvert ✓
   - Vous guider pour créer la scène "ChapCam" dans OBS
   - Ouvrir ChapCam sur la page Live Swap

### **Minute 1-2 : Configurer OBS**
3. Dans la fenêtre OBS qui apparaît :
   - Cliquez sur le **+** dans le panneau Scènes
   - Sélectionnez "Capture de fenêtre"
   - Nom : **"ChapCam"**
   - Sélectionnez "ChapCam" dans la liste des fenêtres
   - Cliquez sur OK
   - Ajoutez un "Dispositif de capture vidéo"
   - Sélectionnez "OBS Virtual Camera"
   - En bas à droite : Cliquez sur **Start Virtual Camera**
   - L'icône devient **verte** = c'est actif ✓

### **Minute 2-3 : Configurer ChapCam**
4. ChapCam s'ouvre dans votre navigateur à http://localhost:3000/dashboard/live-swap
5. Cliquez sur le bouton **"Démarrer le Live Swap"**
6. Accordez l'accès à la webcam quand le popup apparaît
7. Votre visage devrait apparaître avec l'indicateur "En direct"

### **Minute 3-5 : Configurer WhatsApp**
8. Ouvrez WhatsApp Desktop (si pas encore fait)
9. Menu → **Settings** (ou `Ctrl+,`)
10. Allez dans **Devices** → **Camera**
11. Cliquez sur le dropdown et sélectionnez **"OBS Virtual Camera"**
    - (ou "ChapCam Camera" selon votre configuration)
12. Démarrez un appel vidéo avec quelqu'un
13. **La personne voit votre visage AI swapé en temps réel !** ✅

## 🎯 Problèmes fréquents et solutions immédiates :

### ❌ "WhatsApp montre toujours ma webcam native"
**Solution :** Allez dans WhatsApp → Settings → Devices → Camera → Sélectionnez **"OBS Virtual Camera"**
- Vérifiez que la scène OBS "ChapCam" est sélectionnée en haut à droite d'OBS
- Vérifiez que l'icône Start Virtual Camera est verte en bas à droite d'OBS

### ❌ "Écran noir dans OBS ou ChapCam"
**Solution :** Le code déjà inclus dans `electron/main.js:16` désactive l'accélération matérielle :
- `app.disableHardwareAcceleration()`
- Cela force le rendu logiciel que OBS peut capturer
- Redémarrez OBS et ChapCam après ce changement

### ❌ "Erreur: 'Le moteur Live n'est pas configure'"
**Solution :** Vérifiez votre fichier `.env.local` :
- DOIT contenir `LIVE_GPU_WS_URL=ws://localhost:8765`
- DOIT contenir `LIVE_GPU_SHARED_SECRET=votre-cle-secrete`
- Ces deux variables sont OBLIGATOIRES pour le Live Swap

### ❌ "Nothing se passe quand je clique Démarrer"
**Solution :**
1. Vérifiez que le serveur Next.js tourne (port 3000)
2. Vérifiez que OBS est ouvert avec la scène "ChapCam"
3. Vérifiez que la OBS Virtual Camera est démarrée (icône verte)
4. Regardez le fichier `chapcam-debug.log` pour les erreurs précises

## 📋 Liste de contrôle "Tout est prêt" :

Avant d'appeler quelqu'un, vérifiez ces 4 points :

- [ ] **OBS Studio** est ouvert
- [ ] **Scène "ChapCam"** est sélectionnée en haut à droite d'OBS
- [ ] **Start Virtual Camera** icône **verte** en bas à droite d'OBS
- [ ] **WhatsApp Desktop** → Settings → Devices → Camera → **"OBS Virtual Camera"** sélectionnée
- [ ] **ChapCam** navigateur → "Démarrer le Live Swap" cliqué
- [ ] **Next.js serveur** tourne sur port 3000

## 🛠️ En cas de problème ultime :

1. Fermez TOUT : ChapCam, OBS, WhatsApp
2. Attendez 10 secondes
3. Lancez OBS Studio en premier
4. Créez/selectionnez scène "ChapCam"
5. Cliquez sur **Start Virtual Camera** (icône verte)
6. Lancez `START_PARFAIT.ps1` (re-démarre Next.js si besoin)
7. Ouvrez ChapCam navigateur → "Démarrer le Live Swap"
8. Ouvrez WhatsApp → Settings → Devices → Camera → "OBS Virtual Camera"
9. Appelez quelqu'un

## ✅ Fichiers inclus dans ce setup :

| Fichier | Purpose |
|---------|---------|
| `.env.local` | Configuration GPU requise (LIVE_GPU_WS_URL + SECRET) |
| `START_PARFAIT.ps1` | Setup complet automatisé (vérification + démarrage) |
| `WHATSAPP_CAMERA_TROUBLESHOOTING.md` | Guide dépannage détaillé |
| `start-chapcam-desktop.bat` | Script Batch simple (alternative) |
| `start-chapcam-desktop.ps1` | PowerShell avancé (alternative) |

## 🎉 Résultat attendu :

Une fois ces étapes terminées, la personne à qui vous appelez sur WhatsApp verra :
- ✅ Votre visage transformé par l'IA (tête aux pieds)
- ✅ En temps réel (30 FPS ciblé)
- ✅ Sans aucun délai perceptible
- ✅ Même qualité que le mode payant, mais gratuitement grace à `NEXT_PUBLIC_FREE_LIVE_SWAP=true`

---

**⚡ Démarrez maintenant : Double-cliquez sur START_PARFAIT.ps1 et suivez les 5 minutes chrono !**

---

*Setup créé le: 2026-08-16
*Basé sur ChapCam v2 codebase analysis
*Compatible Windows 11 + OBS Studio + WhatsApp Desktop
*)