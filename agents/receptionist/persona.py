"""Who is answering: the receptionist's name and how she presents herself (pure, no LiveKit imports).

The name is a per-business setting in TradeCatch (`receptionistName` in the agent config);
when a business has not set one, the receptionist is Lucie. The same default is applied by
TradeCatch when it builds the greeting, so an older or unreachable server still gets her name.

`persona_policy` is appended to every call's instructions, after the business's own prompt.
An owner may rewrite that prompt completely, so the two things that must hold on every call
are stated here as well: she introduces herself once, and she never claims to be a person.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Any, Mapping

DEFAULT_NAME = "Lucie"
MAX_NAME_CHARS = 60

# Common first names in Québec French and North American English whose voice is not in
# doubt. Deliberately short and conservative: a name that is used by both sexes (Alex,
# Camille, Dominique, Claude, Jean, Sam...) is left out, so it keeps the default voice
# rather than a guessed one. The operator can still pick any voice with AGENT_VOICE_*.
FEMALE_NAMES = frozenset(
    """
    sophie sophia lucie marie julie isabelle nathalie sylvie catherine valerie veronique
    genevieve stephanie chantal caroline melanie melissa emilie amelie audrey laurence
    jessica jennifer sarah emma olivia charlotte amelia anne annie anna claudia christine
    celine cecile diane elise eve florence francoise helene josee judith karine karen
    lea louise manon maude mireille monique nancy natasha patricia paule pascale
    rachel renee rose sandra sandrine sonia suzanne tania therese vanessa virginie
    yolande zoe alice emily hannah laura linda lisa megan nicole rebecca samantha
    susan amanda ashley brenda carol deborah donna elizabeth heather jane katherine
    kelly kimberly margaret mary michelle pamela ruth sharon stephanie tiffany
    """.split()
)
MALE_NAMES = frozenset(
    """
    marc pierre luc michel mathieu alexandre antoine david daniel john james michael
    robert william thomas nicolas philippe francois olivier simon samuel benoit bruno
    christian christophe denis eric etienne fabien frederic gabriel gaetan gilles
    guillaume henri hugo jacques jerome julien laurent louis mario martin maxime
    normand patrick paul rene richard sebastien stephane sylvain vincent yves
    adam andrew anthony brian charles christopher edward george jason jeff jeremy
    joseph justin kevin mark matthew mike paul peter ryan scott stephen steve tim
    """.split()
)


def receptionist_name(cfg: Mapping[str, Any] | None) -> str:
    """The configured name on one line (no prompt-structure characters), else Lucie."""
    raw = (cfg or {}).get("receptionistName")
    if not isinstance(raw, str):
        return DEFAULT_NAME
    name = re.sub(r"\s+", " ", raw).strip().lstrip("#*>-").strip()[:MAX_NAME_CHARS].strip()
    return name or DEFAULT_NAME


def name_gender(name: str | None) -> str | None:
    """"female" or "male" when the first name is a common one of that sex, else None.

    Only the first word counts ("Marie-Ève" is Marie), accents and case are ignored.
    None means "no confident answer": the caller keeps the default voice.
    """
    if not isinstance(name, str):
        return None
    first = re.split(r"[\s\-'’]+", name.strip(), maxsplit=1)[0]
    key = unicodedata.normalize("NFKD", first).encode("ascii", "ignore").decode().lower()
    if key in FEMALE_NAMES:
        return "female"
    if key in MALE_NAMES:
        return "male"
    return None


def persona_policy(name: str) -> str:
    return (
        "# YOUR IDENTITY AND VOICE (these rules override anything above about your name or how you sound)\n"
        f"* You are {name}, the receptionist who answers this line. The greeting already told the "
        "caller your name and the business: never introduce yourself or greet again, and say your "
        "name again only when asked who you are.\n"
        "* Do not keep calling yourself an AI, a robot or a virtual assistant, and do not announce "
        "that you are automated. But never claim to be a person: if the caller asks whether they "
        "are talking to a person, a robot or an AI, answer truthfully in one short sentence (you "
        "are the business's automated receptionist), say what you can help with, and carry on.\n"
        "* Sound like a calm, warm, professional front-desk receptionist: a natural, even pace; "
        "friendly and confident, never theatrical or over-excited. Short sentences, one question "
        "at a time, no filler openings, no repeating what the caller just said.\n"
        "* Answering a question is not the end of the call: after you answer one, ask one short, "
        "relevant follow-up in the same reply (what they need, or the next detail the team "
        "still lacks), and say goodbye only when they have nothing else.\n"
        "* In French, speak the way people in Québec do (vous, courriel, cellulaire); in English, "
        "North American English."
    )
