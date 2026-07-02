# Passation — Tableau de bord PC (endurance moto) & synchro avec l'appli mobile

But de ce document : permettre, dans une **nouvelle session**, de reprendre le travail PC et de
le **recoller avec l'appli mobile bord-de-piste**. Il décrit l'état exact du livrable PC, son
architecture, le **contrat réseau tel qu'implémenté** (surface d'intégration avec le mobile),
et les points ouverts à aligner.

---

## 1. Livrable & fichiers

- **`index.html`** — l'application PC **complète, un seul fichier** (~140 Ko, ~1350 lignes),
  HTML/CSS/JS vanilla, **aucun build**, **100 % fonctionnel hors ligne** (double-clic).
  Le code réseau (Firebase) est **strictement additif** : sans config ni réseau, l'appli se
  comporte exactement comme avant.
- `PROMPT.md` — prompt/spéc détaillée de l'app (hors synchro).
- `index.static-mockup.html.bak` — ancien portage statique de la maquette (référence, non utilisé).
- Dépôt git local (branche `tableau-bord-endurance`). **Pas de remote configuré** dans
  l'environnement de build → le fichier a été livré directement ; à repartager/committer côté user.

### Historique git (du plus récent au plus ancien)
```
b2efec8 Fix parseur config Firebase (ignore import { … })
70ea286 Synchro : SDK compat par injection <script> (file://) + version réglable + diagnostics
c08e4c8 §16 Synchro appli mobile + code session + QR
ccb2e7b Image highside réelle sur bouton Chute + écran incident
d5295fc Suggestions chronos, alertes prioritaires partout, horloge PC 24h, tours réalisés estimés
ca767f1 Sim sans bond, stratégie sans casser l'attribution, reset conservant pilotes, annulation pit, raccourcis globaux
376f3c9 Alerte plein réglable en course, départ manuel, paramètres scrollables/centrés
f1fa33b Chrono général éditable en course, chute dans le résumé, écran de fin débloqué
5b67879 Arrêter = abandonner (bouton farceur unique)
efdddf5 Affinages incident, chronos, stats, stratégie, abandon
9d9e068 Implémentation initiale (phases 1-3)
198f68d Handoff Claude Design (maquette d'origine)
```

---

## 2. Architecture & invariants (à NE PAS casser)

- **Horloge centralisée `now()`** : toute la logique temporelle passe par `now()`.
  - Normal : `Date.now()`.
  - Simulation (`?sim=1`) : `Date.now() + offset` où l'offset n'avance qu'avec la vitesse
    (x10/x60) ou les sauts manuels **pendant que la page est ouverte** (pas de bond hors-ligne).
- **Résilience par timestamps** : on ne stocke jamais un « temps restant » décrémenté. On stocke
  des **timestamps** (`race.startedAt`, `relais[].startedAt`, `pit.startedAt`, …) et on recalcule
  tout. Un refresh/crash se recale seul.
- **Pause / neutralisation** : gérée par accumulation d'offsets (`race.pausedMs`, `relais[].pausedMs`,
  `pause.since`) — jamais par arrêt d'horloge.
- **Persistance** : tout l'état dans `localStorage` (`save()` à chaque mutation).
- **Rendu** : une fonction `render()` réinjecte le HTML de l'écran courant (`SCREENS[phase]()`),
  `wire()` recâble les événements, la **position de défilement est préservée** entre re-rendus.

### Clés localStorage
| Clé | Contenu |
|---|---|
| `endu.state.v1` | état complet de la course (voir §3) |
| `endu.sim.v1` | `{offsetMs}` (mode simulation) |
| `endu.fb.v1` | config Firebase parsée (objet JSON) |
| `endu.fbver` | version du SDK Firebase (défaut `10.12.0`) |

---

## 3. Forme de l'état (`state`)
```
{
  phase,                 // config|armed|go|live|pit|pitc|driver|incident|laps|stats|
                         // settings|alertR|alertF|alarmTel|finish|crashpit|crashmin
  cfg: {
    durationSec, startHHMM, autoArm, fuelSec, autoResolveSec,
    drivers: [ { name, max(sec), best("m:ss.d"), avg, active:bool } ],   // identité = NOM
    alerts: { fuel:bool, relaisMode:"time"|"laps", relaisTime(sec), relaisLaps(n), finish:bool }
  },
  variant: "A"|"B"|"C",
  race: { startedAt(ts|null), pausedMs },
  relais: [ { driverIdx, startedAt(ts), endedAt(ts|null), pausedMs, laps:[sec…], incident?:bool, lapCancelled?:bool } ],
  pit: { active, startedAt, frozenSec, fromIdx },
  pitHistory: [ { at:"HH:MM:SS", fromIdx, toIdx, durationSec(sec|null), crash?:bool } ],
  selSeg, pitcStep:"ask"|"fix"|"manual", pitcAt,
  pause: { active, since },
  incident: { startedAt, neutralized, crashedIdx } | null,
  ack: { relais, fuel, course }, raceOver,
  confirm, abandonStep, abandonPos, alertReturn, statsReturn, driverReturn, driverMode,
  // ---- synchro mobile ----
  sessionCode,           // code court 4 car. (A-Z hors ambigus + 2-9)
  rentre: { actif, relais_id, ts },
  inbox: [ { id, ts, val(sec), pilote, relEst } ],   // tours reçus du mobile, à placer
  seenLaps: {id:true}, seenAlarms: {id:true},        // dédup persistée
  alarmTel: { id, ts } | null
}
```
> Les pilotes sont identifiés par **nom** (pas d'ID interne). Les relais/pit référencent un
> `driverIdx` (index dans `cfg.drivers`) ; réordonner la stratégie **remappe** ces index pour ne
> pas casser l'attribution passée.

---

## 4. Fonctionnalités (résumé)
- **Config** : durée, heure départ + départ auto, table pilotes (ajout/suppr/réordre/activer),
  alertes (plein on/off+min, fin de relais temps|tours, fin de course). Roster vide au démarrage.
- **Départ** : auto armé (part seul à HH:MM) ou manuel (`Espace`) ; **GO** plein écran. Si auto
  désactivé, « Démarrer » lance immédiatement.
- **Live** : décompte relais (dégradé vert→orange→rouge sur les chiffres), décompte course,
  bloc pilote (nom, n° relais, écoulé, **tours restants estimés**), horloge **PC 24h**,
  3 variantes A/B/C, onglets Stats/Paramètres coulissants, **puce synchro** (état + code).
- **Pit (`Espace`)** : PIT STOP + chrono → « Est-ce correct ? [O]/[N] » → Oui / (Non → saisir mm:ss
  | inconnu) → rotation pilote (saute désactivés). Auto-résolution « inconnu » après délai réglable.
  **Annulable** (`Échap`).
- **Changer pilote (`R`)** : corrige le pilote du relais **en cours** (garde les chronos).
- **Incident/chute (`X`)** : écran calme (image highside rouge), « temps depuis l'incident »,
  neutraliser (pause course+relais, décomptes figés et visibles) vs continuer, **remplacement
  après chute** (chute reste sur le tombé, chronos remis à zéro, apparaît dans le résumé arrêts),
  stratégie éditable, reprise, fausse alerte (undo).
- **Chronos (`C`)** : barre segmentée par relais (nom du pilote), saisie mm:ss.d + **suggestions**
  (−2/−1/dernier/+1/+2 s), tours **modifiables/supprimables/réordonnables**, + **inbox** des
  chronos reçus du mobile.
- **Alertes** (prioritaires **sur toutes les pages**, retour à la page d'origine) : fin de relais
  (flash rouge + sirène), fin de course (drapeau à damier + son festif), plein (bannière),
  fin réelle → « VA CHERCHER LES BIÈRES » → stats. **Alarme mobile** (violet, distincte).
- **Stats (`S`)** : par pilote (temps piloté, relais, meilleur tour, moyenne, **régularité**=σ) ;
  arrêts & changements (heure, sortant→entrant, durée éditable, « inconnu » exclu de la moyenne,
  « chute » à part) ; **tours réalisés** & **projection** (temps ÷ allure) ; **export CSV**.
- **Paramètres (`P`)** : **chrono général corrigeable en course** (heure de départ OU temps
  restant), alerte plein, délai auto-résolution, stratégie (ordre + actif/inactif), **synchro
  (code + QR + config Firebase + version SDK)**, **Arrêter=Abandonner** (bouton farceur : 3
  esquives → double confirmation → export CSV → retour création), Reset. Scrollable, position
  conservée. Reset/arrêt **conservent** noms + derniers chronos.
- **Reprise crash** : en pit → « Toujours en pit stop ? » puis « il y a combien de minutes ? ».

### Calculs clés
- **Allure pilote** : moyenne des chronos saisis ; sinon `avg` ; sinon `best × 1.03`.
- **Régularité** : écart-type des tours du pilote.
- **Tours réalisés** = Σ_relais ( temps piloté du relais ÷ allure du pilote ).
- **Projection** = tours réalisés + ( temps course restant ÷ allure du pilote en cours ).

### Raccourcis
`Espace` (machine pit), `R` (pilote), `X` (chute), `C` (chronos), `S` (stats), `P` (paramètres),
`O/N` (confirmations), `Échap` (fermer/annuler), `Ctrl+Z` (undo).
`S`/`P` accessibles **partout sauf** chute, pit et écrans transitoires/alertes.

### Simulation (`?sim=1`)
Panneau bas-gauche : +1min/+10min/+1h, x1/x10/x60, « Simuler un crash » (reload). Invisible sans
le paramètre d'URL.

### QR (autonome, embarqué)
Encodeur QR maison (byte mode, niveau L, versions 1-4, meilleur masque) — **vérifié** par
round-trip (ré-encodage → décodage → syndromes Reed-Solomon = 0). Rendu SVG. `qrSVG(text, px)`.
Encode le **code brut** (ex. `AB12`), pas une URL.

---

## 5. SYNCHRO MOBILE — contrat réseau **tel qu'implémenté côté PC**

> C'est la **surface d'intégration** avec le mobile. Les chemins et noms de champs suivent le
> contrat figé fourni. À vérifier/aligner avec ce que le mobile écrit/lit réellement.

### 5.1 Chargement du SDK (important)
- SDK Firebase **« compat »** chargé par **injection de `<script src>`** (pas de `import()` de
  module) → **fonctionne en `file://`** (double-clic) ET en http. C'était la cause du « pas de
  connexion » quand la page était ouverte en `file://` (les modules ES distants y sont bloqués).
- URLs : `https://www.gstatic.com/firebasejs/<FB_VER>/firebase-app-compat.js` puis
  `…/firebase-database-compat.js`. **`FB_VER` réglable** (Paramètres → config → champ
  « SDK Firebase v… », ou `localStorage['endu.fbver']`, défaut `10.12.0`).
- Chargé **seulement si une config a été saisie**. Tout est en `try/catch`, échecs silencieux
  côté fonctionnel mais **visibles** (puce + ligne d'erreur + logs console `[sync] …`).
- API utilisée : `firebase.initializeApp(cfg)`, `firebase.database(app)`, `db.ref(path).set(…)`,
  `db.ref(path).on('child_added'|'value', cb)`, plus `db.ref('.info/connected')` pour l'état réel.

### 5.2 Config Firebase
Collée telle quelle depuis la console (le snippet complet avec `import { initializeApp } …` est
accepté : le parseur cible l'objet contenant `apiKey`/`databaseURL`). Stockée dans
`localStorage['endu.fb.v1']`. **`databaseURL` obligatoire** (RTDB). Projet de test utilisé par le
user : `endurance-tsc`, `databaseURL = https://endurance-tsc-default-rtdb.europe-west1.firebasedatabase.app`.

### 5.3 Code de session
- Généré au départ de la course : **4 caractères** (`A-Z` sans I/O/… ambigus + `2-9`).
- = `id_course` (nœud racine `sessions/{code}`).
- Affiché **en grand + QR** sur l'écran Départ **et** dans Paramètres (accessible à tout moment
  via `[P]`), + **puce discrète** sur le live. « Nouveau code » possible dans Paramètres.

### 5.4 `state` publié par le PC → `sessions/{code}/state`
Publié à chaque changement pertinent (via `save()` débounce 150 ms) + **battement toutes les 12 s**.
**Uniquement des timestamps** (ms, via `now()`), jamais de « temps restant ».
```
{
  pilote_courant: string,              // NOM du pilote sur la moto
  roster: string[],                    // NOMS des pilotes actifs, dans l'ordre de rotation (désactivés exclus)
  relais: {
    debut_ts: number,                  // relais[cur].startedAt
    cible_fin_ts: number,              // instant "à rentrer" ; mode temps = fixe, mode tours = estimation republiée
    mode_alerte: "temps" | "tours"
  } | null,
  course: { fin_ts: number } | null,   // startedAt + durée + pauses
  pause: boolean,                      // true pendant neutralisation
  rentre: { actif: boolean, relais_id: number|null, ts: number|null },  // actif=true AU déclenchement de l'alerte fin de relais, remis à false au relais suivant
  maj_ts: number
}
```
Détail `cible_fin_ts` (choix PC) :
- **mode temps** : `startedAt + (max − relaisTime)*1000 + pauses` (moment où l'alerte se déclenche).
- **mode tours** : `now() + max(0, relaisRem − relaisLaps*allure)*1000`, republié quand l'allure
  change (le mobile l'affiche avec « ≈ »).
> Le **panneautage « RENTRE » côté mobile doit se baser sur `rentre.actif`**, pas sur `cible_fin_ts`.

### 5.5 Écoute des tours : `sessions/{code}/laps/{id_unique}` (écrits par le mobile)
Attendu : `{ id_unique, id_course, timestamp, valeur_chrono, pilote_vu_tel, id_relais_estime }`.
- **Dédup** sur `id_unique` (persistée dans `state.seenLaps`).
- Chaque tour reçu va dans **l'inbox** de l'écran Chronos : le team manager le **place** dans le
  relais sélectionné (bouton « Placer → R{n} ») ou l'ignore. `id_relais_estime` = indication, pas
  vérité. Si `pilote_vu_tel` ≠ pilote PC du relais → signal **« ⚠ pilote tél ≠ pilote PC »**, sans
  rien modifier automatiquement (le manager tranche avec `R`).
- **Hypothèse à confirmer** : `valeur_chrono` interprété comme **secondes si number**, sinon parsé
  « m:ss.d ». → aligner avec le format réel écrit par le mobile.

### 5.6 Écoute des alarmes : `sessions/{code}/alarms/{id_unique}` (écrits par le mobile)
Attendu : `{ id_unique, id_course, timestamp, type:"ALERTE" }`.
- À réception (dédup `state.seenAlarms`, on ignore l'historique antérieur au branchement) :
  **overlay violet distinct + son**, prioritaire sur toutes les pages.
- **ACK immédiat** : le PC écrit `sessions/{code}/alarms/{id_unique}/ack = { timestamp: now() }`.

### 5.7 État réseau (diagnostic)
- `.info/connected` pilote la puce : `○` aucune config · `◐` connexion/erreur · `●` connecté.
- Dernière erreur affichée (Paramètres) : `chargement échoué` (gstatic bloqué/pare-feu),
  `écriture refusée: PERMISSION_DENIED` (règles RTDB), etc. Logs console `[sync]`.

---

## 6. Points ouverts / à aligner avec le mobile (IMPORTANT pour la fusion)
1. **Identité pilote = NOM (string)** côté PC (`pilote_courant`, `roster`). Si le mobile compare
   par autre chose, soit garder le nom, soit introduire un ID partagé (⇒ adapter les deux).
2. **`valeur_chrono`** : format exact écrit par le mobile (secondes ? « m:ss.d » ? ms ?) — le PC
   gère number=secondes / string=« m:ss.d ». À figer.
3. **`id_relais_estime`** : convention d'indexation (base 1 comme l'UI PC « R1, R2… » ? base 0 ?).
   Le PC l'affiche tel quel comme indication.
4. **`mode_alerte`** : valeurs `"temps"` / `"tours"` (le PC publie ça ; vérifier ce que lit le mobile).
5. **Sémantique `cible_fin_ts`** (moment « à rentrer ») — confirmer que le mobile l'interprète pareil.
6. **Règles de sécurité RTDB** : le PC n'authentifie pas. Il faut des règles autorisant
   read/write sur `sessions/$id` (sinon `PERMISSION_DENIED`).
7. **Version du SDK** : PC réglable (`FB_VER`, défaut 10.12.0, compat). Aligner si besoin.

---

## 7. Limites connues / non testé dans l'environnement de build
- **Connexion Firebase réelle non testée ici** (egress réseau bloqué dans l'environnement) : la
  logique est en place et défensive, mais un vrai test PC↔téléphone reste à faire.
- **Scan du QR non testé sur un vrai téléphone** : l'encodeur est validé algorithmiquement
  (round-trip + syndromes RS = 0), mais à confirmer d'un coup de caméra. Repli : code textuel.
- Tout le reste (config, pit, incident, chronos, stats, CSV, sim, persistance, code+QR, parsing
  config, inbox, diagnostics) a été **vérifié via navigateur automatisé** (Playwright/Chromium).

---

## 8. Comment tester rapidement
- Ouvrir `index.html` (double-clic). Mode test : `index.html?sim=1`.
- Synchro : Paramètres `[P]` → déplier « Config Firebase » → coller le snippet → Enregistrer →
  la puce doit passer `◐` puis `●`. Sinon lire la ligne d'erreur / la console (`[sync]`).
- Vérifier côté Firebase console (Realtime DB) l'apparition de `sessions/{code}/state`.
