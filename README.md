# tonicarD
Applicazione web per l'annotazione semiautomatica del catalogo Caronti.
## Istallazione ambiente
1. Nella cartella principale installa Bootstrap ('npm install bootstrap@5.2.2' oppure visita https://getbootstrap.com/docs/5.2/getting-started/download/).
2. Nella cartella _server_ installa l'ambiente python. Attivalo e installa Flask e le altre librerie:
  - $ python3 -m venv venv
  - $ venv/bin/activate
  - pip install Flask
  - pip install Flask-Cors
  - pip install Pillow
  - pip install Shapely
  - pip install --upgrade google-cloud-vision
  - pip install numpy
  - pip install waitress
3. Carica le immagini delle schede nella cartella *all_caronti_cards*
4. Attiva il back-end: 'python3 app.py'
5. Lancia l'app *index-html*
