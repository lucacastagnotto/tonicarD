# tonicarD
Applicazione web per l'annotazione semiautomatica del catalogo Caronti, che comprende le operazioni di segmentazione e trascrizione. Il programma identifica le aree delle schede dove compare del testo e offre strumenti di manipolazione di immagine al fine di generare nuove foto ritagliando quella originale nelle zone individuate.
## Algoritmo di annotazione
Per la segmentazione e la trascrizione automatica viene usata l'API Cloud Vision di Google, poi la segmentazione viene modificata in modo tale da individuare al più quattro aree: autore, titolo, collocazione e note tipografiche. Per farlo, si esegue l'analisi del layout e del colore.
La correzione delle segmentazione prevede i seguenti passaggi:
1. Eliminazione falsi positivi
2. Identificazione blocco della collocazione
3. Costruzione grafi delle bounding box intersecanti
4. Unione bounding box appartenenti lo stesso grafo
5. Identificazione della etichette delle bounding box
## Analisi layout
Su un piccolo campione di schede si sono calcolate:
1. L'area delle scheda entro cui devono rientrare le scritte affinché vengano considerate per la trascrizione. Le box al di fuori di questo poligono vengono scartate.
2. Le aree della scheda entro cui le bounding box devono rientrare per essere etichettate come autore, tiolo, collocazione o note.
3. I centroidi di ciascun etichetta: corrispondono al punto medio dei centroidi delle bounding box del campione di studio. Servono per stabilire l'etichetta delle bounding box (che tendenzialmente è quella del centroide corrispondente più vicino).
## Istallazione ambiente
1. Nella cartella principale installa Bootstrap (`npm install bootstrap@5.2.2` oppure visita https://getbootstrap.com/docs/5.2/getting-started/download/).
2. Nella cartella _server_ installa l'ambiente python. Attivalo e installa Flask e le altre librerie:
  - $ python3 -m venv venv
  - $ venv/bin/activate
  - $ pip install Flask
  - $ pip install Flask-Cors
  - $ pip install Pillow
  - $ pip install Shapely
  - $ pip install --upgrade google-cloud-vision
  - $ pip install numpy
  - $ pip install waitress
3. Configura l'API Vision di Google https://cloud.google.com/vision/docs/setup
4. Salva il file JSON con la chiave del service account Google nella cartella *server/cred/*
5. Carica le immagini delle schede nella cartella *all_caronti_cards*
6. Attiva il back-end: `$ python3 app.py`
7. Lancia l'app *index-html*
