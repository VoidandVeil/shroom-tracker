# 🍄 Shroom Tracker

Google Sheets + Google Calendar tracker for mushroom cultivation projects.

- Submit entries via Google Form  
- Automatic **18:00 calendar events** for “Next check” dates  
- **Daily digest email** with due + overdue projects  
- **Dark-mode web GUI** to edit status, snooze, add notes/photos, or delete projects  
- Built entirely with **Google Apps Script** (Sheets, Calendar, Mail)  

---

## ✨ Features

- **One-click setup** – runs a `setup_()` function that installs triggers, sets locale = `en_US`, and timezone = `Europe/Stockholm`.  
- **Calendar events** – each entry gets a 18:00–19:00 meeting, updated automatically when you edit the row.  
- **Daily digest** – email at 18:00 with “Due today” + “Overdue” items.  
- **Dark-mode GUI** – filter, search, update status, snooze (+2d/+5d/+7d), add notes, paste photo URLs, or delete entries.  
- **Retired items** – automatically remove their calendar events.  

---

## 🚀 Quick Start (Developers)

```bash
git clone https://github.com/YOURNAME/shroom-tracker.git
cd shroom-tracker
npm install
npm run login
npx clasp create --type standalone --title "Shroom Tracker"
npm run push
npm run open
