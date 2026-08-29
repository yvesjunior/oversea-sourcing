# Brief client — Portail entreprise B2B (OSI Solutions)

> **Source:** `Dossier_portail_entreprise_OSI_pour_programmeur.docx` (version de
> travail destinée au programmeur, remise par le propriétaire le 2026-08-29).
> Transcription fidèle du document, conservée ici parce que le `.docx` ne vit
> nulle part ailleurs que sur le poste du propriétaire. **Ceci est la demande,
> pas la décision** — les décisions sont dans
> [ADR-002](../adr/ADR-002-transaction-and-contract-centre.md).

## 1. Objectif du portail

Créer un espace sécurisé destiné aux clients commerciaux d'OSI Solutions. Le
portail doit centraliser tout le cycle d'approvisionnement international :
demandes, fournisseurs, soumissions, commandes, contrats, documents, paiements,
communications et rapports. **L'expérience doit donner l'impression qu'OSI
orchestre la transaction complète, et non seulement la recherche de
fournisseurs.**

## 2. Navigation principale

| Onglet | Fonction |
|---|---|
| Tableau de bord | Vue synthèse des dossiers actifs, soumissions, commandes, économies et livraisons. |
| Demandes | Création et suivi des demandes d'approvisionnement. |
| Fournisseurs | Fournisseurs proposés, qualification, score, pays, certifications et historique. |
| Soumissions | Comparaison des offres et sélection d'une proposition. |
| Commandes | Suivi du bon de commande, production, inspection, transport et livraison. |
| Contrats | Création, consultation, signature multiparti, rappels et historique. |
| Documents | Factures, certificats, douanes, inspection, packing list, B/L et pièces jointes. |
| Paiements | Dépôts, soldes, factures, frais OSI et état des paiements. |
| Messages | Communication centralisée par transaction ou projet. |
| Rapports | Dépenses, économies, performance fournisseur et données d'approvisionnement. |
| Paramètres | Entreprise, utilisateurs, rôles, permissions et préférences. |

## 3. Onglet Contrats — priorité du développement

Cet onglet doit devenir le centre contractuel de chaque transaction. Un contrat
est rattaché à un dossier OSI et peut impliquer plusieurs parties : client
acheteur, fournisseur, OSI, transporteur, inspecteur, courtier en douane ou
autre sous-traitant.

### 3.1 Vue liste

- Filtres : Tous, Actifs, À signer, En attente, Complétés, Expirés.
- Recherche par numéro, entreprise, fournisseur, type de contrat ou projet.
- Colonnes minimales : N° contrat, objet, parties, valeur, statut, signatures, date.
- Bouton principal : « Nouveau contrat ».
- Indicateur clair du nombre de signatures obtenues : ex. 2/4.

### 3.2 Fiche d'un contrat

Numéro unique du contrat, titre / objet, transaction ou commande liée, acheteur,
fournisseur, sous-traitants impliqués, valeur et devise, Incoterm si applicable,
conditions de paiement, date de création, date d'échéance, statut, documents et
annexes, historique des actions.

### 3.3 Signatures multiparties

| Partie | Rôle | Statut | Action |
|---|---|---|---|
| Client ABC | Acheteur | Signé | Voir |
| Fournisseur XYZ | Fournisseur | Signé | Voir |
| Transporteur | Logistique | En attente | Envoyer un rappel |
| Courtier | Douanes | En attente | Envoyer un rappel |

## 4. Flux contractuel recommandé

1. Une soumission est acceptée par le client.
2. OSI crée automatiquement le dossier de transaction.
3. Le système détermine les contrats requis selon les intervenants.
4. Les modèles sont préremplis avec les données du dossier.
5. Chaque partie reçoit uniquement les documents qu'elle doit consulter ou signer.
6. La signature électronique est enregistrée avec date, heure, utilisateur et piste d'audit.
7. Des rappels automatiques sont envoyés aux signataires en attente.
8. Lorsque toutes les signatures obligatoires sont obtenues, le contrat passe à « Finalisé ».
9. La prochaine étape opérationnelle est débloquée : dépôt/paiement, production, inspection, transport, douanes puis livraison.

## 5. Types de contrats à prévoir

- Mandat / entente de service entre le client et OSI.
- Contrat ou bon de commande acheteur-fournisseur.
- Entente avec le transporteur / transitaire.
- Mandat de courtage en douane.
- Mandat d'inspection ou de contrôle qualité.
- Entente de confidentialité (NDA).
- Annexes : spécifications produit, conditions commerciales, échéancier, Incoterm et modalités de paiement.

## 6. Rôles et permissions

| Rôle | Accès attendu |
|---|---|
| Administrateur client | Accès aux dossiers de son entreprise, approbations et signatures autorisées. |
| Utilisateur client | Accès limité selon les permissions accordées. |
| Équipe OSI | Gestion des dossiers, fournisseurs, contrats et coordination. |
| Fournisseur | Accès uniquement aux transactions et documents qui le concernent. |
| Sous-traitant | Accès limité à son mandat, ses documents et ses signatures. |

> ⚠️ Les deux dernières lignes sont **hors périmètre v1** — décision du
> propriétaire 2026-08-29 : les fournisseurs et sous-traitants n'ont pas accès
> à la plateforme pour l'instant ; le personnel OSI gère l'interaction avec eux
> (voir ADR-002).

## 7. Exigences techniques à discuter

- Interface responsive desktop/tablette avec identité visuelle noir, anthracite et or.
- Authentification sécurisée et contrôle d'accès par rôles.
- Architecture multi-entreprises : aucune entreprise cliente ne doit voir les données d'une autre.
- API de signature électronique à sélectionner (ex. fournisseur spécialisé de e-signature).
- Piste d'audit immuable pour signatures et actions importantes.
- Versionnage des contrats et conservation du PDF final signé.
- Notifications courriel et notifications dans le portail.
- Stockage sécurisé des documents et politique de rétention.
- Journalisation des événements et sauvegardes.
- Prévoir des API pour intégrer ultérieurement partenaires logistiques, douaniers, financiers et outils IA.

## 8. Direction visuelle

Conserver l'identité actuelle d'OSI : fond noir/anthracite, surfaces légèrement
plus claires, accents or pour les actions principales, texte blanc/gris, statuts
clairement différenciés. Le design doit rester premium mais sobre : priorité à
la lisibilité des données et aux actions.

| Usage | Référence |
|---|---|
| Or principal | `#D4AF37` |
| Or secondaire | `#C89C18` |
| Fond principal | `#111111` |
| Surface | `#1E1E1E` |
| Surface secondaire | `#202020` |
| Texte clair | `#E6E6E6` |

## 9. MVP recommandé (par le document)

Prioriser : authentification, tableau de bord, demandes, fournisseurs,
soumissions, commandes, contrats, documents et notifications. **Le module
Contrats doit déjà permettre la signature multiparti et une piste d'audit.**
Paiements avancés, rapports détaillés et automatisations IA peuvent ensuite être
enrichis par phases.

## 10. Écran de référence

Le document embarque une planche 16:9 (`word/media/image1.png`) montrant le
tableau de bord, la liste des contrats et la fiche contrat avec le tableau des
signatures. **C'est une direction UX/UI** : structure, hiérarchie et style. Les
données affichées sont fictives.

> **Notes du visuel à ignorer** — la planche mentionne « Next.js » et « AWS S3 »
> côté technique. L'application tourne sur TanStack Start, et le stockage est un
> volume local derrière un adaptateur de forme S3 (décision d'infrastructure :
> aucun fournisseur cloud). Ce sont des notes de graphiste, pas des exigences.
