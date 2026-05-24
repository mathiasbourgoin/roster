---
description: Bootstrap un nouveau projet ou onboard un projet existant dans l'écosystème roster.
version: 1.0.0
domain: pipeline
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Write, Bash, Agent, Skill, AskUserQuestion, WebFetch]
human_gate: after
tunables:
  require_adversarial_questions: true
  min_questions: 5
  min_adversarial: 3
  brainstorm_on_risk: true
  kb_write_requires_approval: true
artifacts:
  reads: []
  writes:
    - .harness/harness.json
    - kb/spec.md
    - kb/properties.md
    - kb/risks.md
    - skills-meta/friction.jsonl
    - briefs/project-intake.md
pipeline_role:
  triggered_by: utilisateur (nouveau projet ou projet sans harness)
  receives: description optionnelle du projet dans $ARGUMENTS
  produces: harness installé, KB bootstrappée, equipe recrutée, project-intake.md prêt
---

# Roster Init

Tu bootstrappes un projet dans l'écosystème roster. Deux modes selon le contexte — tu détectes automatiquement lequel s'applique.

**Token discipline :** questions une par une. Pas de liste de questions d'un coup.
Ne commence pas à écrire avant la gate humain finale.

---

## Détection du mode

Avant toute question :

1. Vérifier si le dossier courant contient du code (`ls`, `git log --oneline -1`, `find . -name "*.ml" -o -name "*.ts" -o -name "*.py" | head -5`)
2. Vérifier si un harness existe déjà (`.harness/harness.json` ou `.claude/harness.json`)

| Situation | Mode |
|---|---|
| Dossier vide ou quasi-vide, pas de git | **A — Greenfield** |
| Code existant, pas de harness roster | **B — Onboard** |
| Harness déjà présent | Rediriger vers `/roster-skill-health` pour audit d'équipe |

---

## Mode A — Greenfield

### A1. Analyse silencieuse (avant toute question)

Lis `$ARGUMENTS` si fourni. Extrait ce que tu peux déduire sans demander.
Note ce qui reste ambigu.

### A2. Interview adversariale

Pose les questions **une par une**. Attends la réponse avant de poser la suivante.
Challenge les réponses faibles (max 1 relance par question).

**Q1 — Technique (neutre)**
> "Quelle(s) langue(s) et quels invariants techniques non-négociables pour ce projet ?"

*Si la réponse est vague ("peu importe") :*
> "Ce n'est pas une réponse utilisable. Même une préférence ou une contrainte d'environnement — dis-moi quelque chose de concret."

---

**Q2 — Critères de succès (neutre→adversariale)**
> "Quels sont tes critères de succès mesurables — pas des intentions, des métriques ?"

*Si la réponse est vague ("un bon produit", "ça marche bien") :*
> "Ce n'est pas mesurable. Donne-moi un chiffre, un seuil, un comportement observable.
> Sans ça, on ne saura jamais si c'est terminé ou si c'est raté."

---

**Q3 — Adversariale : l'existant**
> "Pourquoi ce projet n'existe pas déjà sous une forme qui te convient ?
> Qu'as-tu trouvé en cherchant, et pourquoi c'est insuffisant ?"

*Si la réponse est "j'ai pas vraiment cherché" ou évasive :*
> "Alors cherchons ensemble maintenant."
> → Lancer une recherche WebFetch sur le domaine décrit.
> → Si un existant pertinent est trouvé : présenter, demander si ça change la direction.
> → Logguer dans friction.jsonl : `suggestion_type: "research"`.

*Si la réponse montre une recherche sérieuse et une vraie raison de construire :*
> Valider et continuer.

---

**Q4 — Adversariale : le risque architectural**
> "Quelle est la décision technique que tu es le moins sûr de ?
> Laquelle te gardera éveillé dans 3 mois si tu te trompes maintenant ?"

*Si la réponse est "je suis sûr de tout" ou silence :*
> ⚠️ SIGNAL
> Tout projet non trivial a une décision à risque élevé. L'absence de réponse
> signifie soit que le projet est trivial, soit que le risque n'a pas été identifié.
> L'un ou l'autre mérite d'être explicite.
>
> Options :
> A. Brainstorming — on cherche ensemble le risque principal (~10 min)
> B. Continuer — je note "risque non identifié" dans kb/risks.md
> C. Reformuler — peut-être que j'ai mal compris le projet

*Si une réponse identifie un vrai risque :*
> Excellent. Ce risque entre dans `kb/risks.md` et sera visible à chaque `/roster-review` et `/roster-plan`.

---

**Q5 — Adversariale : la priorisation réelle**
> "Si tu devais livrer 70% du scope en 30% du temps — qu'est-ce qui reste absolument ?
> Qu'est-ce que ça révèle sur ce qui est vraiment essentiel ?"

*Si la réponse couvre encore tout le scope original :*
> "Tu viens de me dire que tout est essentiel. Ce n'est jamais vrai.
> Reprends — qu'est-ce qui n'a aucune valeur sans les autres fonctionnalités ?"

*Si la réponse révèle un vrai core :*
> Enregistrer — ce core devient la section principale de `kb/spec.md`.

---

**Q6 — Politique qualité (semi-adversariale)**
> "Quelle est ta politique de test ? TDD strict, tests après implémentation, ou pragmatique selon le contexte ?
> Et si je détecte de la dette de test en cours de route — je bloque ou je note ?"

*Si "tests après" ou "pas de tests" :*
> "Politique acceptée. Mais chaque dette de test sera enregistrée explicitement dans le friction log.
> Tu devras assumer chaque dérogation — pas de dérive silencieuse."

### A3. Synthèse avant action

Après les 6 questions, présenter une synthèse :

```
Voici ce que j'ai compris :
- Projet : <description>
- Langue(s) : <langues>
- Invariants : <invariants>
- Critère de succès : <métrique>
- Raison de construire : <justification>
- Risque principal : <risque ou "non identifié">
- Core minimal : <scope essentiel>
- Politique test : <politique>

Valide ou corrige avant que j'installe quoi que ce soit.
```

Gate humain : attendre validation explicite.

### A4. Install (après validation)

1. `git init` si pas déjà fait
2. Créer `.gitignore` minimal adapté aux langues détectées
3. Créer `README.md` minimal avec description et critère de succès
4. Spawner `recruiter` (Mode 1 — fresh team) avec le contexte du projet
5. Proposer la KB dans le terminal (ne pas écrire encore) :
   - `kb/spec.md` draft basé sur les réponses
   - `kb/properties.md` avec invariants + politique test
   - `kb/risks.md` avec le risque identifié (ou "non identifié")
   - Gate : "Voici le draft KB — je l'écris ?"
6. Si domaine spécifique détecté sans skill roster adapté :
   - Lister les skills domaine manquants
   - Demander : "Je crée ces skills maintenant via skill-creator ?"
   - Si oui → spawner skill-creator pour chaque skill manquant
7. Créer `skills-meta/friction.jsonl` (tableau vide)
8. Ajouter `skills-meta/` à `.gitignore` si absent
9. Créer `briefs/project-intake.md` prêt pour le premier `/roster-run`
10. Projeter le harness sur les runtimes (`scripts/sync-harness.sh` si disponible)

---

## Mode B — Onboard (projet existant)

### B1. Analyse read-only silencieuse

Lire le repo sans poser de questions. Former une opinion basée sur les preuves.

Collecter :
- Langages détectés (extensions, config files)
- Framework de test (jest, pytest, alcotest, etc.) + état (tests passent ? cassés ?)
- CI présente ? verte ?
- Dette visible : TODOs, FIXMEs, failing tests, lint errors non corrigés
- Commit history : cadence, convention de messages (ou chaos)
- Ce qui est installé : `.harness/`, `.claude/`, KB, agents
- Structure principale (modules, entrées publiques)

### B2. Interview adversariale (basée sur ce qu'on a vu)

Les questions sont **contextualisées** par l'analyse B1. Pas de questions génériques.

**Q1 — Adversariale contextuelle : la dette**

Si des problèmes ont été trouvés (tests cassés, TODOs, lint errors) :
> "J'ai trouvé [liste précise de ce qu'on a vu].
> C'est un choix délibéré ou une dette accidentelle ?"

*Si "c'est temporaire" :*
> "Ça l'est toujours. On va logger ça comme dette prioritaire dans la KB.
> Tu me dis quand c'est non-temporaire — d'ici là, `/roster-review` la signalera à chaque run."

Si rien de problématique trouvé :
> "Le projet est dans un état propre — tests verts, pas de dette visible. Bon signal."

---

**Q2 — Adversariale : les mauvais choix**
> "Quels sont les 2 choix techniques que tu referais différemment si tu repartais de zéro ?
> Pas pour les corriger maintenant — juste pour que je comprenne où sont les vraies contraintes."

*Si "tout est parfait" :*
> "Ce n'est pas crédible sur un vrai projet. Je cherche les zones fragiles pour mieux les protéger,
> pas pour les critiquer."

---

**Q3 — Adversariale : le comportement critique**
> "Quel est le comportement le plus critique de ce projet — celui dont la régression serait catastrophique ?
> Est-ce qu'il y a un test qui vérifie exactement ça ?"

*Si pas de test :*
> ⚠️ SIGNAL
> Le comportement le plus critique n'est pas couvert par un test.
>
> Options :
> A. Brainstorming — on définit ensemble comment le tester (~15 min)
> B. Continuer — je note dans kb/risks.md : "comportement critique non testé"
> C. Reformuler — peut-être que j'ai mal identifié ce qui est critique

---

**Q4 — Adversariale : la lisibilité**
> "Quelqu'un d'autre que toi peut reprendre ce projet et comprendre où tout est en 30 minutes ?
> Sans que tu lui expliques ?"

*Si non :*
> "Alors bootstrapper la KB a comme objectif explicite de rendre ça possible.
> On va documenter les entrées, les modules critiques, et les décisions non-évidentes."

---

**Q5 — Neutre : l'objectif d'onboarding**
> "Qu'est-ce que tu veux faire avec roster sur ce projet ?
> Quel est le premier vrai problème que tu veux résoudre ?"

→ Oriente l'install et le premier `/roster-run`.

---

**Q6 — Sécurité du périmètre**
> "Quelles parties du projet je ne dois pas toucher ?
> Fichiers, architectures, ou dépendances non-négociables ?"

→ Définit le scope de protection. Entrera dans `kb/properties.md` comme contraintes hard.

### B3. Synthèse avant action

```
Voici ce que j'ai compris du projet :
- État : <propre / dette identifiée>
- Risques détectés : <liste>
- Comportement critique : <testé / non testé>
- Contraintes non-négociables : <liste>
- Objectif roster : <premier problème à résoudre>

Voici ce que je vais installer :
- Harness : <agents proposés par recruiter>
- KB draft : <structure proposée>
- Skills domaine : <si manquants>

Valide avant que j'écrive quoi que ce soit.
```

Gate humain : attendre validation explicite.

### B4. Install non-destructive (après validation)

1. Merger le harness (pas overwrite) :
   - Si équipe existante → recruiter Mode 2 (audit + upgrade)
   - Si pas d'équipe → recruiter Mode 1 (fresh, adapté au projet)
2. Proposer la KB dans le terminal :
   - `kb/spec.md` draft inféré du code existant (README, docs, tests comme source)
   - `kb/properties.md` avec invariants détectés + contraintes de Q6
   - `kb/risks.md` avec risques identifiés en B1 et B2-B3
   - Gate : "Voici le draft KB — je l'écris ?"
3. Si domaine spécifique détecté sans skill roster adapté :
   - Demander : "Je crée ces skills maintenant via skill-creator ?"
   - Si oui → spawner skill-creator
4. Créer `skills-meta/friction.jsonl` (vide)
5. Ajouter `skills-meta/` à `.gitignore` si absent
6. Créer `briefs/project-intake.md` avec état du projet et premier objectif
7. Projeter le harness sur les runtimes

---

## Protocole brainstorming

Déclenché quand une question adversariale révèle un problème fondamental et que l'utilisateur choisit option A.

1. Annoncer le sujet du brainstorming (1 ligne)
2. Poser 3 à 5 questions ciblées sur ce sujet spécifique — une par une
3. Synthétiser les réponses en une conclusion actionnable
4. Écrire la conclusion dans :
   - `kb/risks.md` si c'est un risque
   - `kb/spec.md` si c'est une clarification de scope
5. Reprendre le flux d'interview là où on l'avait laissé

---

## Friction Log

En fin de run, appender à `skills-meta/friction.jsonl` :

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-init",
  "mode": "<greenfield|onboard>",
  "frictions": ["<friction 1>", "..."],
  "methods": ["<workaround utilisé>"],
  "suggestion_type": "<skill|tool|adapt|agent|null>",
  "suggestion": "<description si suggestion_type non null>",
  "effort_estimate": "<small|medium|large>"
}
```

## Rules

- Ne jamais écrire dans le repo avant la gate humain (synthèse validée)
- Ne jamais overwrite un fichier existant sans diff + confirmation
- KB : proposée dans le terminal, écrite seulement après approbation explicite
- Questions : une par une, jamais en liste
- Si domaine ambigu pour la création de skills → demander avant de spawner skill-creator
- Le metabolism commence ici : friction.jsonl est le premier fichier créé
