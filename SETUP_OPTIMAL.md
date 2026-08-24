# 📦 ChapCam Desktop - Setup Optimale Complète
## Fonctionnement WhatsApp & Telegram • Version 2026

---

## 🎯 Objectif
Faire apparaître votre visage AI swapé en temps réel sur WhatsApp Desktop et Telegram Desktop.

---

## ⚠️ Prérequis (Incontournables)

| Élément | Statut | Note |
|---------|--------|------|
| **OBS Studio** | ⬅️ Requis | `obsproject.com` - Version 64-bit |
| **Chapitcam Desktop** | ⬅️ Requis | Application Electron locale |
| **Webcam physique** | ⬅️ Requis | Installée et fonctionnelle |
| **Navigateur** | ⬅️ Requis | Chrome, Edge ou Firefox |
| **Windows 10/11** | ⬅️ Requis | Paramètres de confidentialité à configurer |

---

## 🛠️ Installation Étape par Étape (Automatisée)

### **Étape 1 : Lancer le script de setup**

Exécutez l'un des deux selon votre système :

#### **Windows (PowerShell recommandé) :**
```powershell
# 1. Ouvrez PowerShell en mode Administration
# 2. Exécutez :
& "C:\chapcam2\chapcam-kz\start-chapcam-desktop.ps1"

# ou en ligne de commande :
powershell -ExecutionPolicy Bypass -File "C:\chapcam2\chapcam-kz\start-chapcam-desktop.ps1"
```

#### **Windows (Batch) :**
```cmd
C:\chapcam2\chapcam-kz\start-chapcam-desktop.bat
```

#### **Linux / macOS** :
```bash
cd /chemin/vers/chapcam-kz
chmod +x start-chapcam-desktop.sh  # (si disponible)
./start-chapcam-desktop.sh
```

---

### **Étape 2 : Que se passe-t-il automatiquement ?**

Le script exécute ces actions séquentielles :

| Action | Statut | Temps |
|--------|--------|-------|
| Vérifier port 3000 / lancer Next.js | ✅ Automatique | 0-30s |
| Détecter/lancer OBS Studio | ✅ Automatique | 15-60s |
| Guider création scène "ChapCam" OBS | 👤 Intermédiaire | 2-3min |
| Démarrer OBS Virtual Camera | ✅ Automatique | < 1min |
| Ouvrir ChapCam Live Swap | ✅ Automatique | < 1s |

---

## 📋 Checklist de Configuration OBS (Non automatisable à 100%)

Après le script, **vous devez réaliser ces 4 étapes manuelles dans OBS** :

### **1. Créer la scène "ChapCam"**
1. Ouvrez OBS Studio
2. Dans le panneau **Scènes** (gauche), cliquez sur le bouton `+`
3. Sélectionnez **Capture de fenêtre**
4. Nom : `ChapCam`
5. Cliquez sur `OK`
6. Dans la liste fenêtre, sélectionnez `ChapCam` (doit apparaître)
7. Cliquez sur `OK`

### **2. Ajouter la capture vidéo**
1. Toujours dans OBS, cliquez sur `+` → **Dispositif de capture vidéo**
2. Dans le champ **Périphérique**, sélectionnez `OBS Virtual Camera`
3. Cliquez sur `OK`
4. Dans les paramètres de la scène, désactivez **Verrouiller le rapport d'aspect**
5. Redimensionnez la vidéo pour qu'elle remplit le viewport (glissez les poignées)

### **3. Démarrer la Virtual Camera**
1. En bas à droite d'OBS, trouvez le bouton **Start Virtual Camera**
2. S'il dit "Start" → Cliquez dessus
3. L'icône devient **verte** ✅
4. "Virtual Camera activée" s'affiche
5. Le flux vidéo est maintenant disponible système-wide

### **4. Confirmer le statut**
- Le badge "ChapCam" apparaît en vert en haut à droite d'OBS
- La scène est sélectionnée (non grise)
- La Virtual Camera est démarrée (icône verte)

---

## 💬 Configuration WhatsApp

### **WhatsApp Desktop (.exe) - Site officiel :**

1. Ouvrez WhatsApp Desktop
2. Appuyez sur `Ctrl + ,` (ou **Settings** → **Appareils**)
3. Dans le menu de gauche, cliquez sur **Appareils** → **Caméra**
4. Dans la liste déroulante, sélectionnez **`OBS Virtual Camera`**
5. ⚠️ **Important** : Gardez la fenêtre ChapCam visible (non minimisée)
   - Si vous minimisez ChapCam pendant un appel, le flux OBS devient noir
   - OBS capture seulement la fenêtre active/visible
6. Démarrez un appel vidéo
7. Vous devriez voir votre visage AI swapé ! ✅

**Dépannage WhatsApp :**
- Si la caméra semble noire : vérifiez que ChapCam n'est pas minimisé
- Si WhatsApp ne liste pas OBS Virtual Camera : redémrez WhatsApp et OBS
- Si écran noir persistant : vérifiez les paramètres confidentialité Windows (voir plus bas)

### **WhatsApp Web (Chrome/Edge) :**

1. Ouvrez Chrome ou Edge
2. Allez sur `web.whatsapp.com`
3. Dans l'appel vidéo, cliquez sur l'icône de caméra
4. Sélectionnez **`OBS Virtual Camera`**
5. Le flux apparaît depuis ChapCam via OBS

⚠️ **WhatsApp Microsoft Store** : **NON COMPATIBLE** - La sandbox Windows empêche l'accès aux caméras virtuelles. Utilisez toujours la version .exe du site officiel.

---

## 💬 Configuration Telegram

### **Telegram Desktop :**

1. Ouvrez Telegram Desktop
2. Allez dans **Settings** (menu hamburger → Settings)
3. Dans la section **Privacy and Security**, cliquez sur **Video Calls** → **Camera**
4. Dans le sélecteur de caméra, choisissez **`OBS Virtual Camera`**
5. Démarrez un **appel vocal** ou **vidéo**
6. Votre visage AI swapé apparaît ✅

### **Telegram Web :**

1. Sur `web.telegram.org`, démarrez un appel vidéo
2. Cliquez sur l'icône de caméra pendant l'appel
3. Sélectionnez **`OBS Virtual Camera`**
4. Le flux ChapCam apparaît

---

## ⚙️ Paramètres Windows 11 (Confidentialité)

Après l'installation, vérifiez ces paramètres :

1. ** Démarrer → Settings** (ou `Windows + I`)
2. **Privacy and security** → **Camera**
3. ** Autoriser l'accès à la caméra sur cet appareil** : **Activé**
4. ** Autoriser les applications à accéder à votre camera** : **Activé**
5. Faites défiler et assurez-vous que :
   - **WhatsApp** : **Activé** ✅
   - **OBS Studio** : **Activé** ✅
   - **ChapCam** : Si visible, **Activé** ✅

### **Scénario problème : "L'accès à la caméra est refusé"**

Si WhatsApp/Telegram affichent "Caméra inaccessible" ou écran noir :

1. Répétez les étapes ci-dessus
2. Redémrez complètement ChapCam et OBS
3. Redémrez WhatsApp/Telegram
4. Si toujours problème : redémrez l'ordinateur

---

## 🚀 Scripts Fournis

### **start-chapcam-desktop.bat** (Windows)
```cmd
:: Lance automatiquement :
1. Vérifie/démarre Next.js sur port 3000
2. Lance OBS Studio si nécessaire
3. Guide pas à pas pour la scène OBS "ChapCam"
4. Démarre la OBS Virtual Camera
5. Ouvre http://localhost:3000/dashboard/live-swap
6. Affiche les instructions WhatsApp ET Telegram
7. Pause finale pour lire les instructions
```

### **start-chapcam-desktop.ps1** (Windows PowerShell)
```powershell
:: Version avancée avec :
- Test de connexion TCP robuste
- Lancement propre de next dev
- Couleurs et formatage lisible
- Instructions WhatsApp ET Telegram détaillées
- Résumé final avec tous les états
```

---

## 🔧 Dépannage Complet

### **Problème : Écran noir dans WhatsApp/Telegram**

| Cause | Solution |
|-------|----------|
| Scène OBS non sélectionnée | Dans OBS, vérifiez que "ChapCam" est sélectionnée en haut à droite |
| Virtual Camera non démarrée | Dans OBS, cliquez sur "Start Virtual Camera" (icône doit être verte) |
| Fenêtre ChapCam minimisée | Gardez ChapCam en première plan pendant l'appel |
| Permission Windows refusée | Vérifiez Settings → Privacy → Camera |
| Version Microsoft Store WhatsApp | Désinstallez, installez depuis web.whatsapp.com |
| Conflit d'appareils | Redémrez Ordinateur → OBS → WhatsApp dans cet ordre |

### **Problème : Latence ou lag**

| Cause | Solution |
|-------|----------|
| Mode cloud sur PC non-gamer | Passez en mode "Local" si vous avez un PC gamer |
| Qualité vidéo trop élevée | Dans ChapCam → Réglages → Qualité → "Standard" ou "HD" |
| Grosse charge réseau | D'autres appareils téléchargent/uploadent en même temps |

### **Problème : "Impossible d'ouvrir la connexion temps réel"**

| Cause | Solution |
|-------|----------|
| Serveur Next.js non démarré | Relancez le script setup |
| OBS pas encore lancé | Lancez OBS Studio manuellement |
| Scène OBS manquante | Suivez les 4 étapes de configuration OBS |
| Tunnel GPU non configuré | Contactez l'administration (variables d'environnement LIVE_GPU_*) |

---

## ✅ Checklist de Vérification Finale

Exécutez ce mini-test avant d'appeler :

| Test | Résultat Attendu | ✅/❌ |
|------|------------------|------|
| 1. OBS Studio ouvert | Interface OBS visible | |
| 2. Scène "ChapCam" sélectionnée | "ChapCam" en haut à droite d'OBS | |
| 3. Virtual Camera START | Icône verte en bas à droite d'OBS | |
| 4. ChapCam Live Swap ouvert | Navigateur sur `localhost:3000/dashboard/live-swap` | |
| 5. Live Swap actif | Bouton "Arrêter le Live Swap" visible | |
| 6. WhatsApp caméra | Settings → Devices → Camera → "OBS Virtual Camera" sélectionnée | |
| 7. Test appel | Appelez quelqu'un → Vois votre visage AI swapé | |

---

## 📞 Support et Aide

**Si tout échoue :**
1. Exécutez à nouveau `start-chapcam-desktop.ps1` ou `.bat`
2. Vérifiez le fichier `chapcam-debug.log` situé à la racine du dossier
3. Utilisez le bouton "Diagnostic" dans ChapCop → Copie des logs → Envoyez-nous
4. Rejoignez le support Telegram : `t.me/chapcam1`

**Ressources :**
- Documentation : `http://localhost:3000/dashboard/mes-demandes` (une fois connecté)
- Dépannage WhatsApp : `WHATSAPP_CAMERA_TROUBLESHOOTING.md` (fourni avec l'install)
- Support direct : `@chapcam1` sur Telegram

---

## 🎉 Résultat Attendu

Après ce setup complet :

```
✅ Votre visage est transformé par l'IA en temps réel
✅ Ça fonctionne sur WhatsApp Desktop (.exe)
✅ Ça fonctionne sur Telegram Desktop
✅ Ça fonctionne sur WhatsApp Web (Chrome/Edge)
✅ Ça fonctionne sur Telegram Web
✅ Vous pouvez basculer entre les apps sans réconfiguration
✅ La qualité est fluide en 720p30 (ou 1080p sur PC gamer)
```

---

**Dernière mise à jour :** 2026-08-19  
**Version :** Setup Optimale v2.0  
**Support :** `t.me/chapcam1`