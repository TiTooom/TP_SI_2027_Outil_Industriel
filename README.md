# Développement d’une Solution de Relevé de Données Process

Dans un environnement industriel de plus en plus connecté, disposer d’outils capables de récupérer et d’exploiter les
données des process est devenu essentiel pour surveiller en temps réel, prévenir les pannes, optimiser la
consommation énergétique, et maintenir les standards de qualité. Ces données contribuent ainsi à une meilleure
performance globale et à la réduction des coûts.

Cependant, les outils de supervision actuels, souvent basés sur des technologies propriétaires, présentent plusieurs
inconvénients :

- Coût élevé : Des licences et matériels onéreux qui impactent les budgets d’investissement.
- Dépendance aux fournisseurs externes : Un manque d’autonomie pour ajuster et personnaliser les outils en
fonction des besoins spécifiques.
- Rigidité : Des systèmes peu flexibles, limitant leur adaptabilité aux évolutions rapides des besoins.
  
# Enjeux & Défis

Ce projet vise à créer une solution de suivi indépendante et flexible, permettant aux industriels de surveiller leurs
process en toute autonomie et à moindre coût, tout en répondant à différents besoins. Cette solution permettrait :
- Une indépendance technologique : S’affranchir des solutions propriétaires pour éviter les coûts de licence et
gagner en autonomie.
- Adaptabilité et déploiement rapide : Mettre en place les outils de suivi efficacement, notamment en cas de
besoin urgent de visibilité sur les données.
- Flexibilité et modularité : Adapter les systèmes de suivi aux besoins spécifiques de chaque installation.

En s’appuyant sur des technologies open source, cette solution offre aux industriels un contrôle total sur leur suivi de
données sans dépendance vis-à-vis de fournisseurs tiers. Elle est conçue pour être facilement déployable, modulable,
et paramétrable afin que les techniciens puissent définir eux-mêmes les automates et variables à surveiller. Plus qu’une
simple solution technique, il s’agit de développer un outil stratégique pour l’industrie, qui répond aux exigences
d’autonomie et de résilience tout en restant accessible financièrement

# Description de l’application

Votre mission est de concevoir un prototype de solution de suivi modulaire et portable, pensé pour s’adapter à divers
environnements industriels. Cette application open source doit fournir aux industriels un outil de suivi indépendant et
flexible, capable de surveiller en temps réel les variables critiques d’automates (par exemple, température, pression).
Elle doit permettre aux utilisateurs de configurer facilement les adresses IP des automates et les variables à surveiller
via une interface intuitive. Les données collectées seront affichées sur un tableau de bord interactif pour faciliter
l’analyse et la prise de décision. Pensée pour un déploiement rapide sur un réseau local, cette application représente
une alternative aux solutions propriétaires, offrant une autonomie totale tout en minimisant les coûts.

# Objectifs de l'application

1. Paramétrage des variables : Une interface simple pour configurer les paramètres des automates et définir les
variables à surveiller.
2. Supervision en temps réel : Un tableau de bord clair et interactif pour visualiser les variables monitorées.
3. Utilisation de solutions open source : Un développement basé sur des technologies libres pour garantir
indépendance et maîtrise des coûts.
4. Déploiement rapide : Une architecture permettant une installation en quelques minutes, adaptée aux besoins
urgents de supervision.

# Parcours utilisateur envisagé
Le parcours utilisateur met en lumière les fonctionnalités clés auxquelles les techniciens ou ingénieurs auront accès
pour surveiller et exploiter les données en temps réel et historique.

1. Accès à l’application : L’application est accessible via un navigateur sur le réseau local de l’entreprise.
L’utilisateur (technicien, ingénieur, etc.) peut accéder aux fonctionnalités de configuration et de supervision.
2. Configuration des paramètres : L’utilisateur peut ajouter ou modifier les paramètres des variables à surveiller.
Pour chaque variable, il peut définir le nom, l’adresse IP de l’automate, la variable à lire, et la fréquence
d’enregistrement. Ces paramètres sont sauvegardés dans la base de données pour être utilisés par le backend.
3. Supervision en temps réel : Pour chaque variable surveillée, un tableau de bord affiche les données en temps
réel sous forme de graphiques. Ce graphique se met à jour automatiquement en fonction de la fréquence
d’enregistrement configurée. Cette interface simple permet à l’utilisateur d’interpréter les résultats
rapidement sans autre logiciel spécifique.
4. Consultation des données historiques : Les données des variables surveillées peuvent être exportées via une
interface dotée d’un formulaire permettant de définir une plage de dates. L’export se fait au format CSV, afin
de faciliter leur exploitation dans d’autres outils spécifiques ou leur partage avec d’autres équipes.

# Parcours Backend envisagé

Le parcours backend détaille les processus invisibles qui orchestrent la récupération des données des automates, leur
stockage et leur mise à disposition pour le frontend.

1. Initialisation et Chargement des Paramètres : Au démarrage, le backend se connecte à la base de données
pour récupérer la liste des variables à surveiller (IP des automates, registres à lire, fréquence, etc.). Il initialise
les tâches périodiques de supervision en fonction des paramètres configurés.
2. Surveillance et Lecture des Automates : Le backend lit et les variables automate à surveiller, à intervalles
réguliers, en fonction de la fréquence définie pour chaque variable dans la base de données. Il gère les
connexions Modbus et gère les erreurs en cas de défaillance de connexion ou de lecture.
3. Enregistrement des Données en Base : Après chaque lecture, les valeurs récupérées sont sauvegardées dans
la base de données, avec un horodatage. Cette historisation permet la consultation et l’export des données par
les utilisateurs.
4. API REST pour le Frontend : Le backend expose des routes pour permettre au frontend de notamment :
o Ajouter, modifier ou supprimer des paramètres de surveillance.
o Afficher les valeurs de la variable surveillée pour interprétation sous graphique depuis le frontend.
o Récupérer les données historiques pour une période donnée et les mettre à disposition en
téléchargement via un fichier CSV.
5. Gestion des Tâches Périodiques : Le backend surveille en continu les variables configurées grâce à des tâches
périodiques (par exemple, avec node-cron ou un équivalent). Ces tâches s'adaptent dynamiquement : si des
modifications sont apportées dans la configuration (par exemple, ajout d'une nouvelle variable), elles sont
prises en compte sans nécessiter de redémarrage du serveur.
6. Déploiement et Accessibilité : Le backend est déployé dans un conteneur Docker et configuré pour écouter
sur un port spécifique. Il est accessible depuis d’autres machines du réseau pour communiquer avec le frontend
ou d’autres services.

---

## Relevé de données process

Cette application relève périodiquement des valeurs (température, pression…) sur des automates. Un automate est un petit calculateur industriel qui pilote une machine. Le relevé se fait en Modbus TCP, le protocole standard qui permet de lire les registres (cases numérotées) d'un automate sur le réseau. Les valeurs sont enregistrées avec leur date et leur heure dans MariaDB, puis affichées en graphiques dans le navigateur.

Avancement : la configuration, le relevé, le tableau de bord temps réel et l'export CSV sont faits. Les comptes (jalon 5) ne sont pas encore faits.

## Schéma

```mermaid
flowchart LR
    NAV["Navigateur"] -->|"port 8080"| NGX["nginx (frontend)"]
    NGX -->|"/api/..."| API["Backend<br/>Node.js + Express"]
    API -->|"SQL"| DB[("MariaDB")]
    API -->|"Modbus TCP, port 502"| PLC["Automate ou simulateur"]
```

## Lancer le projet

Prérequis : Docker Desktop (avec WSL2 sous Windows), ou Docker Engine + Docker Compose v2.

```bash
cp .env.example .env          # sous PowerShell : Copy-Item .env.example .env
docker compose up -d --build
```

Remplacer les mots de passe dans `.env` avant le premier lancement. Puis ouvrir http://localhost:8080.

Pour repartir de zéro : `docker compose down -v` (cela efface toutes les données).

## Utiliser l'application

1. **Configuration** : ajouter un automate (adresse IP, port, unit ID), puis les variables à surveiller (registre, adresse, type, fréquence). Un automate « Simulateur » et quatre variables de démonstration sont déjà présents au premier lancement.
2. **Tableau de bord** : une carte et un graphique par variable, mis à jour automatiquement. Si un automate ne répond plus, son état est signalé sur les cartes de ses variables.
3. **Export CSV** : page « Export ». Choisir le début et la fin de la plage (ou un raccourci : 1 h, 24 h, 7 j), cocher les variables, puis cliquer sur « Télécharger CSV ». Le fichier sépare les colonnes par un point-virgule et utilise la virgule pour les décimales : il s'ouvre directement dans Excel en français. Une plage ne peut pas dépasser 31 jours, et un export est limité à 500 000 lignes (l'application le signale avant le téléchargement). L'aperçu graphique de la page Export est indicatif : il ne montre que les 7 derniers jours de la plage.

## Accès depuis un autre PC du réseau

Remplacer `localhost` par l'adresse IP du PC qui fait tourner Docker (commande `ipconfig`), par exemple http://192.168.1.20:8080. Il faut autoriser les ports 8080 et 3000 dans le pare-feu Windows, et passer le réseau en profil « Privé ». Ce test n'est pas encore fait de notre côté.

## Structure du projet

```
BACKEND/    API Express et service de relevé Modbus
FRONTEND/   pages HTML, CSS et JavaScript servies par nginx
SIMULATOR/  automate Modbus factice (température, pression…)
db/         scripts SQL d'initialisation de MariaDB
ASSETS/     captures d'écran
docs/       rapport technique
docker-compose.yml, .env.example
```

## Technologies

- **Backend** : Node.js et Express (API), modbus-serial (lecture Modbus), mysql2 (accès à MariaDB).
- **Base de données** : MariaDB, dans trois schémas séparés (`config`, `prod`, `app`).
- **Frontend** : HTML, CSS et JavaScript sans framework, Bootstrap et Chart.js. Les bibliothèques sont copiées dans le projet, car le réseau d'une usine n'a pas forcément accès à Internet.
- **Déploiement** : Docker Compose avec nginx (serveur web et relais vers l'API).

Mise en garde : l'API n'a pas encore d'authentification (prévue au jalon 5). Toute personne du réseau qui accède au port 3000 peut modifier la configuration.

## Aperçu

Premières captures, avec l'état du système (jalon 1) :

![Page d'accueil : tout est connecté](ASSETS/accueil-ok.png)

![Page d'accueil : base de données coupée](ASSETS/accueil-bdd-coupee.png)

<!-- TODO (humain) : capturer le tableau de bord temps réel, enregistrer l'image dans ASSETS/dashboard.png, puis ajouter ici : ![Tableau de bord temps réel](ASSETS/dashboard.png) -->

## Rapport technique

Le détail (choix techniques, modèle de données, difficultés) est dans [docs/RAPPORT.md](docs/RAPPORT.md).
