# Zapier pour Gladys Assistant

Intégration non officielle, sans lien avec Zapier. Elle n'a encore jamais été testée avec un vrai
compte Zapier : dites-nous comment ça se passe.

## Ce qu'elle fait

- **De Gladys vers Zapier** : les actions de scène **Envoyer à un Zap** et **Envoyer du JSON à un
  Zap** postent un événement vers l'URL _Catch Hook_ d'un Zap. Le Zap s'exécute alors avec les
  champs `event`, `value1`, `value2`, `value3` (ou les clés de votre objet JSON), `source`
  (`gladys`) et `sent_at` (date ISO).
- **De Zapier vers Gladys** (nécessite **Gladys Plus**) : un Zap poste vers l'URL Gladys Plus de
  l'intégration, et vos scènes démarrent sur le déclencheur **Événement reçu de Zapier**, avec les
  variables `event`, `value1`, `value2`, `value3` et `payload` (les autres champs, en JSON).

Zapier n'est appelé que par les deux actions de scène et le bouton **Envoyer un événement de
test** : jamais au démarrage, jamais sur une minuterie, jamais parce qu'un événement a été reçu.

## Coûts : tâches Zapier et exécutions de Zap

« Webhooks by Zapier » est une application premium : il faut une offre Zapier payante. **Chaque
envoi lance le Zap et utilise une tâche Zapier par étape d'action exécutée** : un Zap à 3 étapes d'action utilise 3
tâches. Le module compte des **exécutions de Zap** (une par Zap lancé), pas des tâches, et refuse
un envoi au-delà de ses plafonds : divisez les tâches de votre offre par le nombre d'étapes d'action
de vos Zaps.

- **Nombre maximal d'exécutions de Zap sur 24 heures** (de 1 à 2000, 20 par défaut) ;
- **Nombre maximal d'exécutions de Zap sur 30 jours** (de 1 à 50000, 500 par défaut) : 30 jours glissants, pas
  votre mois de facturation Zapier ; réglez-le sous les tâches de votre offre divisées par le nombre d'étapes d'action, moins ce
  qu'utilisent vos autres Zaps ;
- **10 requêtes par minute** au plus, quels que soient les plafonds, répondues ou non (une requête
  refusée par Zapier compte ici même quand son exécution est rendue) ;
- dès le **troisième refus d'affilée** (réponse 4xx ou redirection), une pause de 60 s, doublée à
  chaque nouveau refus, 6 h au plus, levée par un envoi accepté par Zapier.

Un envoi est compté, et le décompte enregistré dans `/data`, **avant** que sa requête parte (pas
d'enregistrement, pas de requête) : le décompte survit à un redémarrage. Il n'est rendu que si
Zapier ne l'a sûrement pas pris (réponse 4xx, 429, redirection, nom ou connexion refusés). Un envoi
sans réponse claire (délai dépassé, connexion coupée, 5xx) reste compté et **n'est pas retenté** :
un second essai pourrait lancer le Zap deux fois. Le module ne compte que ses propres envois ; votre
tableau de bord Zapier montre les vraies tâches.

## Régler les envois vers Zapier

1. Dans Zapier, créez un Zap dont le déclencheur est **Webhooks by Zapier** → **Catch Hook**.
2. Copiez l'URL affichée par Zapier (`https://hooks.zapier.com/hooks/catch/<compte>/<hook>/`) dans
   **URL Catch Hook 1** de la configuration de l'intégration (jusqu'à trois Zaps : URL 2 et 3).
   Zapier documente la réunion des hooks de plusieurs Zaps du même compte par des virgules
   (`…/catch/123456/zbB61,kzXC4/`) : chaque Zap nommé s'exécute et compte pour une exécution.
3. Cliquez sur **Envoyer un événement de test** : l'événement `gladys_test` (avec `test: true`)
   arrive dans le Zap et compte pour une exécution. Construisez ensuite la suite du Zap avec ses champs.
4. Dans une scène, ajoutez **Envoyer à un Zap** : choisissez le Catch Hook, un nom d'événement (1 à
   64 lettres, chiffres, `_`, `-`, `.`) et jusqu'à trois valeurs (1000 caractères chacune au plus,
   jamais coupées : une valeur plus longue fait refuser l'envoi). Sorties pour les actions
   suivantes : `request_id` (celui de Zapier) et `zap_runs`.

**L'URL Catch Hook est un secret** : quiconque l'a peut lancer le Zap. Elle est gardée par Gladys
dans sa base, jamais réaffichée, envoyée seulement à `hooks.zapier.com`, et jamais écrite dans les
journaux, le statut ni `/data`. Une URL qui n'est pas une URL Catch Hook de Zapier est refusée (et
jamais réaffichée).

## Régler les événements venant de Zapier (Gladys Plus)

Sans Gladys Plus, seuls les envois vers Zapier marchent ; le statut de l'intégration le dit.

1. Liez Gladys Plus et collez votre clé Open API dans le bloc **Webhooks Gladys Plus** de la
   configuration de l'intégration : Gladys affiche l'URL publique du webhook **Événements de
   Zapier**. Cette URL est un secret elle aussi.
2. Dans un Zap, ajoutez l'action **Webhooks by Zapier** → **POST**, URL = cette URL Gladys Plus,
   _Payload Type_ `json`, _Data_ : `event` = votre nom d'événement, et `value1`, `value2`, `value3`
   à votre guise. Les autres clés vont dans `payload`, un objet JSON de 20 clés et 1000 caractères au plus :
   une clé qui ne tient pas est laissée de côté, jamais coupée.
3. Facultatif : saisissez un **secret partagé** (8 à 200 caractères, sans espace) dans la
   configuration, et ajoutez un champ `secret` de même valeur dans le Zap : un événement qui ne le
   porte pas est ignoré. Un secret illisible fait refuser tout événement.
4. Dans une scène, utilisez le déclencheur **Événement reçu de Zapier**, filtré ou non sur le nom
   de l'événement.

Le module publie 60 événements par minute au plus et ignore un corps de plus de 64 Ko.

## Boucles

Un événement reçu n'envoie jamais rien vers Zapier. Mais une scène lancée par **Événement reçu de
Zapier** qui envoie à un Zap qui rappelle Gladys tournerait en boucle et consommerait des tâches.
Le module surveille les envois qu'une scène demande moins de 15 s après un événement reçu : **après 3
d'entre eux en 5 minutes, le suivant est refusé et tous les envois s'arrêtent 30 minutes** (gardé au
redémarrage). Corrigez la scène, puis enregistrez la configuration pour reprendre aussitôt.
Ses limites : une scène qui attend 15 s ou plus avant d'envoyer échappe à la garde, et seuls les
plafonds arrêtent alors la boucle ; un hook qui réunit plusieurs Zaps perd jusqu'à 3 exécutions par
Zap avant l'arrêt.

## Pauses et refus

- **429** (Zapier demande de ralentir) : aucun envoi pendant son `Retry-After`, de 60 s à 6 h.
- **5xx** : aucun envoi pendant 60 s, doublé à chaque nouvel échec, 6 h au plus.
- **404 ou 410** (Zapier ne connaît pas ce hook : Zap supprimé ou URL changée) : les scènes
  n'utilisent plus ce hook. Son empreinte de 8 bits est gardée dans `/data` ; coller une autre URL
  la lève, un succès du bouton de test aussi. Une nouvelle URL saisie pendant l'arrêt de
  l'intégration partage cette empreinte une fois sur 256 : cliquez alors sur le bouton de test.
- **401/403** ne sont pas pris pour un refus du hook.
- `/data` illisible : rien n'est envoyé (les exécutions comptées sont inconnues) ; relu toutes les
  10 s, jamais écrasé.
