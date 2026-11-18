# Notula

Appunti di riunione con trascrizione live e note potenziate dall'AI. PWA installabile su iPhone/Android, nessun backend, costo zero.

## Come funziona
1. **＋** → nuova riunione, scegli un template (Generico, Call commerciale, 1:1, Stand-up, Colloquio, Audit cliente).
2. **Registra** → trascrizione live dal microfono (Web Speech API del browser).
3. Scrivi appunti grezzi nella scheda **Note**.
4. **✦ Migliora note** → l'AI usa i tuoi appunti come scheletro e li completa con la trascrizione.
5. **Chiedi** → domande sulla riunione ("prossimi passi?", "cosa ha detto sul budget?").
6. **⋯** → condividi, copia, scarica Markdown, elimina. Backup/ripristino JSON in ⚙︎.

## Pubblicazione gratuita (5 minuti)
GitHub Pages: crea un repository, carica questi file, Settings → Pages → Deploy from branch `main` / root.
In alternativa: trascina la cartella su app.netlify.com/drop.
Serve HTTPS: il microfono non funziona da `file://`.

Sul telefono: apri l'URL → Condividi → "Aggiungi a schermata Home" (iOS) oppure menu → "Installa app" (Android).

## Motore AI gratuito
- **Google Gemini**: chiave da aistudio.google.com, modello predefinito `gemini-2.5-flash` (modificabile).
- **Compatibile OpenAI**: Groq (`https://api.groq.com/openai/v1`), OpenRouter (modelli `:free`) oppure Ollama locale.
- **Nessuno**: solo appunti e trascrizione.

La chiave resta nel `localStorage` del dispositivo.

## Limiti reali
- **Audio di sistema**: su mobile il browser sente solo il microfono. Va bene per riunioni in presenza o in vivavoce; non cattura l'audio interno di Teams/Zoom con le cuffie.
- **Trascrizione**: Chrome invia l'audio ai server di riconoscimento vocale di Google; Safari usa il riconoscimento Apple. Il riconoscimento si interrompe in background o a schermo bloccato: l'app tiene lo schermo acceso (Wake Lock) quando il browser lo supporta.
- **Speaker**: nessuna separazione per interlocutore.
- **Dati**: restano su un solo dispositivo; non c'è sincronizzazione. Usa il backup JSON.
- **Piani gratuiti**: hanno limiti di richieste e i termini possono cambiare. Sui piani gratuiti i fornitori possono usare i prompt per migliorare i loro modelli: non inserire dati di clienti riservati.
