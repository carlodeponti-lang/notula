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

## Trascrizione
- **Gemini** (predefinito, chiave gratuita da aistudio.google.com): l'audio viene registrato a blocchi da 60 s, salvato sul dispositivo (IndexedDB) e trascritto parola per parola con le etichette dei parlanti (tu / interlocutore, chiamante / chiamato). Se un blocco fallisce: **Riprova**, oppure **⋯ → Ritrascrivi tutto**.
- **Whisper via Groq**: senza riconoscimento dei parlanti.
- **Browser**: solo Chrome, senza parlanti.
- **⚙︎ → Verifica configurazione** controlla microfono, registrazione e chiavi, e mostra l'errore esatto.

## Chiamate telefoniche
- **Mac**: compila Telefono e Ruolo → **📞 Chiama**. FaceTime chiama tramite l'iPhone (Continuity); Notula registra in modalità vivavoce dagli altoparlanti del Mac.
- **iPhone**: iOS non permette a nessuna app di accedere all'audio di una telefonata. Usa la registrazione nativa della chiamata (pulsante registra nella schermata della chiamata, iOS 18.1 o successivo), poi da Note salva l'audio su File e importalo con **⋯ → Importa registrazione audio**.

## Mappa mentale
**✦ Migliora** genera note e mappa mentale; la mappa è disegnata con Mermaid (CDN jsDelivr). Offline viene mostrata come elenco annidato.

## Motore AI gratuito
- **Google Gemini**: chiave da aistudio.google.com, modello predefinito `gemini-2.5-flash` (modificabile).
- **Compatibile OpenAI**: Groq (`https://api.groq.com/openai/v1`), OpenRouter (modelli `:free`) oppure Ollama locale.
- **Nessuno**: solo appunti e trascrizione.

La chiave resta nel `localStorage` del dispositivo.

## Limiti reali
- **Audio di sistema**: su mobile il browser sente solo il microfono. Va bene per riunioni in presenza o in vivavoce; non cattura l'audio interno di Teams/Zoom con le cuffie.
- **Parlanti**: Gemini li distingue da voce e contesto. Non usa impronte vocali come le app native: con voci simili o persone che si sovrappongono può sbagliare.
- **Background**: su iPhone la registrazione si ferma se blocchi lo schermo o cambi app (limite di iOS per le app web). Sul Mac continua anche con la finestra in secondo piano.
- **Dati**: restano su un solo dispositivo; non c'è sincronizzazione. Usa il backup JSON.
- **Piani gratuiti**: hanno limiti di richieste e i termini possono cambiare. Sui piani gratuiti i fornitori possono usare i prompt per migliorare i loro modelli: non inserire dati di clienti riservati.

## Note dall'analisi REA di Granola 7.786.3 (Mac)
Ricavate solo per capire l'architettura; Notula non contiene codice di Granola.
- Due canali audio: microfono ("Me") e audio di sistema ("Them"), catturato con API native macOS (Core Audio tap / ScreenCaptureKit). Un'app web può solo condividere una scheda del browser.
- Trascrizione cloud in streaming (Deepgram predefinito, AssemblyAI come alternativa), oppure locale: Parakeet via sherpa-onnx o whisper-server.
- Separazione degli interlocutori con un binario nativo (`granola-diarizer`) e impronte vocali; dati locali in SQLite cifrato.
