# 🚀 ChapCam - Démarrage Rapide WhatsApp/Telegram
## En 5 minutes chrono

---

## ⚡ Étape 1 : Lancer le setup (1 minute)

**PowerShell (recommandé) :**
```powershell
& "C:\chapcam2\chapcam-kz\start-chapcam-desktop.ps1"
```

**Ou Batch :**
```cmd
C:\chapcam2\chapcam-kz\start-chapcam-desktop.bat
```

---

## 📋 Étape 2 : Suivez les étapes à l'écran (3 minutes)

Le script va faire automatiquement :

```
✅ Vérifier/démarrer le serveur Next.js (port 3000)
✅ Lancer OBS Studio s'il n'est pas ouvert
✅ Vous guider pour créer la scène "ChapCam" dans OBS
✅ Démarrer la OBS Virtual Camera (icône verte en bas à droite)
✅ Ouvrir ChapCam sur http://localhost:3000/dashboard/live-swap
✅ Afficher les instructions WhatsApp ET Telegram
```

**Pendant ce temps, ne touchez à rien !** Le script s'occupe de tout.

---

## 🎛️ Étape 3 : Les 4 gestes OBS (2 minutes)

Après le script, dans OBS Studio, faites ces 4 choses :

1. **Scène "ChapCam"** : Dans le panneau Scènes (gauche), cliquez sur `+` → Capture de fenêtre → Nom : `ChapCam` → OK
2. **Capture vidéo** : Cliquez sur `+` → Dispositif de capture vidéo → Sélectionnez `OBS Virtual Camera` → OK
3. **Désactiver le verrouillage** : Dans les paramètres de la scène, décochez "Verrouiller le rapport d'aspect"
4. **Start Virtual Camera** : En bas à droite d'OBS, cliquez sur le bouton **Start Virtual Camera** → L'icône devient **verte** ✅

---

## 💬 Étape 4 : Configurer WhatsApp (30 secondes)

**WhatsApp Desktop (.exe) :**

1. Ouvrez WhatsApp Desktop
2. `Ctrl + ,` → Settings → Appareils → Caméra
3. Sélectionnez **`OBS Virtual Camera`** dans la liste
4. Démarrez un appel vidéo
5. **Astuce :** Gardez la fenêtre ChapCam visible (pas minimisée)

**WhatsApp Web (Chrome/Edge) :**
- Dans l'appel, cliquez sur l'icône caméra → Sélectionnez **`OBS Virtual Camera`**

---

## 💬 Étape 5 : Configurer Telegram (30 secondes)

**Telegram Desktop :**

1. Ouvrez Telegram Desktop
2. Settings → Privacy and Security → Video Calls → Camera
3. Sélectionnez **`OBS Virtual Camera`**
4. Démarrez un appel vocal ou vidéo
5. Votre visage AI swapé apparaît ✅

---

## ✅ Checklist Finale (avant d'appeler)

| ✅ | Vérification |
|---|---|
|  | OBS Studio est ouvert |
|  | Scène "ChapCam" est sélectionnée (en haut à droite) |
|  | La OBS Virtual Camera a démarré (icône verte en bas à droite) |
|  | ChapCam Live Swap est ouvert dans le navigateur |
|  | Le Live Swap est actif (pas en "connecting") |
|  | WhatsApp/Telegram → Camera → "OBS Virtual Camera" est sélectionné |

---

## ⚠️ Dépannage Rapide

| Problème | Solution Rapide |
|----------|----------------|
| **Écran noir WhatsApp** | 1. Vérifiez que la scène ChapCam est sélectionnée dans OBS<br>2. Vérifiez que la Virtual Camera est démarrée (icône verte)<br>3. Assurez-vous que ChapCam n'est pas minimisé |
| **WhatsApp ne voit pas la caméra** | 1. Redémrez WhatsApp<br>2. Vérifiez les paramètres Privacy de Windows<br>3. Utilisez la version .exe, pas Microsoft Store |
| **Flux très lent** | 1. Dans ChapCam → Réglages → Qualité → "Standard" ou "HD"<br>2. Fermez les autres applications utilisant le réseau |
| **Telegram ne trouve pas la caméra** | 1. Redémrez Telegram<br>2. Vérifiez Settings → Privacy and Security → Video Calls → Camera |

---

## 🎉 Vous êtes prêt !

Une fois ces 5 étapes terminées :

1. 📹 Votre visage est transformé par l'IA en temps réel
2. 💬 Ça fonctionne sur WhatsApp Desktop
3. 💬 Ça fonctionne sur Telegram Desktop  
4. 🌐 Ça fonctionne sur les versions Web (Chrome/Edge)
5. 🔄 Vous pouvez basculer entre les apps librement

**Besoin d'aide ?** Rejoignez le support : `t.me/chapcam1`

---

**Temps total estimé :** 5 minutes  
**Difficulté :** Facile (4 étapes manuelles dans OBS)  
** Prérequis :** OBS Studio installé (≥ 5 minutes d'installation initiale)