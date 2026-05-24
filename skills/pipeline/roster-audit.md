---
description: Audit qualité et conformité — combine code-quality et spec-compliance en un rapport actionnable.
version: 1.0.0
domain: operational
phase: null
preamble: true
friction_log: true
allowed_tools: [Read, Bash, AskUserQuestion]
human_gate: after
tunables:
  max_function_lines: 50
  require_kb: false
  check_spec_compliance: true
  check_code_quality: true
  check_naming: true
artifacts:
  reads:
    - kb/spec.md
    - kb/properties.md
    - kb/glossary.md
  writes:
    - briefs/audit-<date>.md
pipeline_role:
  triggered_by: humain ou /roster-skill-health
  receives: scope optionnel dans $ARGUMENTS (fichiers / modules / tout le repo)
  produces: briefs/audit-<date>.md avec findings actionnables
---

# Roster Audit

Tu audites la qualité du code et sa conformité à la KB. Tu produis des findings actionnables, pas un rapport de style. Chaque finding doit citer le fichier et la ligne.

**Token discipline :** findings concis. Pas de paraphrase de la KB — pointer vers les violations.

## Input Contract

- `$ARGUMENTS` : scope (ex: `ocaml/agent-manager/src/` ou vide pour le repo entier)
- KB si elle existe (`kb/spec.md`, `kb/properties.md`, `kb/glossary.md`)
- Si `tunables.require_kb: true` et KB absente → bloquer et le dire

Scope par défaut si $ARGUMENTS vide : tout le code source (hors `_build/`, `node_modules/`, `dist/`).

## Steps

### 1. Charger les références

Si KB existe :
- Lire `kb/properties.md` → invariants, seuils, contraintes
- Lire `kb/glossary.md` → nomenclature canonique
- Lire `kb/spec.md` → comportements spécifiés

Si KB absente et `tunables.require_kb: false` → continuer avec les défauts (seuils dans tunables).

### 2. Check : taille des fonctions (si `check_code_quality: true`)

```bash
# Identifier les fonctions longues
grep -n "^let \|^  let \|^and " <scope>/**/*.ml | head -100
# (adapter le pattern selon le langage)
```

Seuil : `tunables.max_function_lines` lignes (défaut 50).
Signaler chaque fonction qui dépasse avec : fichier, ligne, taille estimée.

### 3. Check : violations DRY

Chercher les blocs de code dupliqués (≥ 5 lignes identiques ou quasi-identiques).

```bash
# Chercher des patterns répétés
grep -rn "<pattern suspect>" <scope>
```

Signaler avec les deux locations.

### 4. Check : nomenclature (si `check_naming: true` et glossaire disponible)

Pour chaque terme dans `kb/glossary.md` :
- Chercher les variantes (abréviations, synonymes, casse différente)
- Signaler les incohérences avec les deux formes (canonique vs trouvée)

### 5. Check : conformité spec (si `check_spec_compliance: true` et spec disponible)

Pour chaque comportement spécifié dans `kb/spec.md` :
1. Localiser l'implémentation
2. Vérifier la correspondance
3. Vérifier qu'un test couvre ce comportement

Classification :
| Statut | Signification |
|---|---|
| **PASS** | Code conforme + test existant |
| **PARTIAL** | Code conforme + pas de test |
| **DIVERGE** | Code se comporte différemment |
| **MISSING** | Pas d'implémentation trouvée |

### 6. Check : invariants

Pour chaque invariant dans `kb/properties.md` :
- Vérifier qu'il est préservé dans le code
- Si non vérifiable statiquement → noter "non vérifiable statiquement"

### 7. Rapport

Produire `briefs/audit-<YYYY-MM-DD>.md` :

```markdown
# Audit — <date>

**Scope :** <scope audité>
**KB utilisée :** OUI / NON (raison si non)

## Résumé

| Catégorie | Findings | Actionnables |
|---|---|---|
| Taille fonctions | N | N |
| DRY | N | N |
| Nomenclature | N | N |
| Spec compliance | PASS: N / PARTIAL: N / DIVERGE: N / MISSING: N | N |
| Invariants | N | N |

## Findings actionnables

### CRITIQUE / HIGH
<findings qui bloquent ou risquent des régressions>

### MEDIUM
<findings de qualité importants>

### LOW / INFO
<findings mineurs>

## Non actionnables (pour mémoire)
<findings non vérifiables statiquement ou acceptés>
```

### 8. Gate humain

Présenter le rapport et demander :
> "Quels findings veux-tu traiter maintenant ? Je peux créer un `/roster-intake` pour chaque groupe."

## Output Contract

`briefs/audit-<date>.md` avec findings classifiés et actionnables.

## Friction Log

```jsonl
{
  "date": "<ISO-8601>",
  "skill": "roster-audit",
  "task": "audit",
  "frictions": [],
  "methods": [],
  "suggestion_type": null,
  "suggestion": null,
  "effort_estimate": null
}
```

## Rules

- Tout finding doit citer fichier et ligne — jamais de généralité
- "Le code a l'air propre" n'est pas un finding
- Sans KB → appliquer les seuils tunables, ne pas inventer de règles
- Non vérifiable statiquement → le dire explicitement, ne pas supposer
- Ne jamais modifier le code pendant l'audit
