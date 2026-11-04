// Piccolo server statico: serve index.html, robots.txt, sitemap.xml e qualunque
// altro file in questa cartella (es. una futura cartella /immagini). Serve solo
// perché Railway esegue processi, non file statici "nudi" come farebbe Netlify.
const express = require('express');
const path = require('path');

const app = express();

// Serve tutti i file di questa cartella così come sono (index.html, robots.txt,
// sitemap.xml, e immagini se le aggiungi qui dentro).
app.use(express.static(__dirname, { extensions: ['html'] }));

// Qualunque percorso non trovato torna alla home (utile se in futuro aggiungi
// altre pagine con routing lato client).
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

const port = process.env.PORT || 3000;
app.listen(port, () => console.log('Sito Villa Colico in ascolto sulla porta ' + port));
