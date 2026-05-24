---
name: roster-skill-evolve
description: Implémente les améliorations approuvées par skill-health — skills, outils, adaptations, agents.
version: 1.0.0
domain: meta
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Write, Edit, Bash, Agent, Skill, AskUserQuestion]
human_gate: both
artifacts:
  reads:
    - skills-meta/health-<date>.md
  writes:
    - skills/<domain>/<name>.md
    - scripts/<name>.sh
    - .harness/harness.json (via sync-harness.sh)
pipeline_role:
  triggered_by: /roster-skill-health avec propositions APPROUVÉ
  receives: skills-meta/health-<date>.md
  produces: skills / scripts / patches installés dans le harness
---

# Roster Skill Evolve

Tu implémentes les améliorations approuvées par `/roster-skill-health`. Tu travailles proposition par proposition, avec une gate humain avant chaque install.

**Token discipline :** une proposition à la fois. Pas de batch silencieux.

## Input Contract

Trouver le rapport le plus récent :
```bash
ls -t skills-meta/health-*.md | head -1
```

Lire ce fichier. Extraire les propositions marquées `**APPROUVÉ**`.

Si aucune proposition APPROUVÉ :
> "Aucune proposition approuvée dans le dernier rapport.
> Relancer `/roster-skill-health` pour analyser le friction log."

## Steps

Pour chaque proposition APPROUVÉ, dans l'ordre A → B → C → D :

### Proposition [SKILL] — Nouveau skill

1. **Gate avant** : présenter le nom et la description proposée. Confirmer le domaine (`pipeline`, `operational`, `meta`).

2. **Search first** :
   - Chercher dans `skills/` si un skill similaire existe
   - Chercher dans l'index roster (`index.json`) si disponible
   - Si équivalent trouvé → proposer adaptation plutôt que création

3. **Invoquer skill-creator** :
   Spawner le sub-agent `skill-creator` avec :
   - Description de la capacité
   - Domaine cible
   - Contexte des frictions qui ont motivé la création
   - Path : `.claude/agents/` (lire depuis le harness installé)

4. **Review du skill généré** :
   - Vérifier frontmatter (description, version, domain, friction_log, preamble)
   - Vérifier présence des sections requises (Input Contract, Steps, Output Contract, Friction Log, Rules)
   - Vérifier cohérence avec les artefacts des skills adjacents
   - Appliquer corrections si nécessaires

5. **Gate après** : présenter le skill final. Demander approbation d'install.

6. **Install** :
   ```bash
   # Placer dans le domaine approprié
   mv <skill-draft> skills/<domain>/roster-<name>.md

   # Ajouter au harness.json
   # (section layers.skills)

   # Projeter sur les runtimes si sync-harness.sh disponible
   bash scripts/sync-harness.sh 2>/dev/null || echo "sync manuel requis"
   ```

---

### Proposition [TOOL] — Outil déterministe

1. **Gate avant** : présenter le nom du script et son comportement attendu.

2. **Écrire le script** dans `scripts/` :
   - Header de documentation obligatoire :
     ```bash
     #!/usr/bin/env bash
     # <nom>.sh — <description une ligne>
     # Usage: ./<nom>.sh [args]
     # Motivé par: friction "<friction originale>" (<N> occurrences)
     # Ajouté le: <date>
     set -euo pipefail
     ```
   - Comportement déterministe — mêmes inputs → mêmes outputs
   - Exit code explicite (0 = succès, non-zero = erreur)
   - Message d'erreur utile sur stderr

3. **Tester le script** :
   - Cas nominal
   - Cas d'erreur (input manquant, environnement cassé)
   - Documenter les cas testés dans le header

4. **Référencer dans le skill concerné** :
   - Ouvrir le skill qui génère la friction
   - Remplacer le workaround par l'appel au script dans la section Steps
   - Bump version (patch : +0.0.1)

5. **Gate après** : montrer le script et le diff du skill modifié.

---

### Proposition [ADAPT] — Adaptation de skill existant

1. **Gate avant** : présenter le skill cible, la section à modifier, et le changement proposé.

2. **Lire le skill actuel** dans son intégralité.

3. **Appliquer le patch** :
   - Modifier uniquement la section identifiée
   - Ne pas toucher au reste
   - Bump version :
     - Changement de comportement minor : +0.1.0
     - Fix / clarification : +0.0.1

4. **Vérifier la cohérence** :
   - Les artefacts produits correspondent toujours aux artefacts lus par le skill suivant
   - Les Rules ne sont pas contredites par les nouveaux Steps
   - Le Friction Log est toujours présent

5. **Gate après** : présenter le diff. Demander approbation avant de sauvegarder.

6. **Projeter** si le skill est dans `.claude/commands/` :
   ```bash
   cp skills/<domain>/roster-<name>.md .claude/commands/roster-<name>.md
   ```

---

### Proposition [AGENT] — Nouvel agent dédié

1. **Gate avant** : présenter le rôle, le domaine, et les frictions qui le motivent. C'est un investissement large — confirmer explicitement.

2. **Séquencer** :
   - D'abord invoquer `skill-creator` pour définir le profil du skill associé
   - Puis invoquer `recruiter` en Mode 1 avec le nouveau rôle comme besoin identifié
   - Gate humain entre les deux

3. **Suivre le workflow recruiter standard** pour l'install dans le harness.

---

## Output Contract

Pour chaque proposition APPROUVÉ :
- [SKILL] → `skills/<domain>/roster-<name>.md` installé + harness mis à jour
- [TOOL] → `scripts/<name>.sh` créé + skill concerné patché
- [ADAPT] → skill patché + version bumpée
- [AGENT] → agent installé via recruiter

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-skill-evolve",
  "task": "skill-evolution",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Une proposition à la fois — jamais de batch silencieux
- Gate humain avant ET après chaque install
- Search first pour les skills — ne pas créer ce qui existe
- Ne jamais modifier un skill en dehors de la section identifiée dans la proposition ADAPT
- Si skill-creator échoue → noter dans friction.jsonl et passer à la proposition suivante
- Le friction log de skill-evolve lui-même est une source de méta-amélioration
