"""Localized strings + spec builders for the phone-UI cutaways (rendered by ui/render_ui.mjs).
All names, numbers and addresses are fictional (555-01xx numbers are reserved for fiction)."""
import config as C

STR = {
 "en": dict(
   date="Tuesday, March 11", dateNext="Wednesday, March 12", decline="Decline", accept="Accept", missedTitle="Missed Call", now="now", sub="Laval, QC",
   bizPlumb="NorthStar Plumbing", bizElec="NorthStar Electric",
   calling="calling...", ended="Call ended", mute="mute", keypad="keypad", speaker="speaker", add="add call", video="video", contacts="contacts",
   connecting="connecting...", query="plumber near me", resultsTitle="PLUMBERS NEAR YOU",
   co1="NorthStar Plumbing", co1meta="Laval  ·  1.2 km", noAnswer="No answer", co2="Laval Pipe & Drain", co2meta="Open now  ·  2.1 km", callBtn="Call",
   co3="Rapid Plumbing Laval", co3meta="Open now  ·  3.4 km",
   sheetTitle="Call summary", sheetTitleB="Request summary", badge="Sample summary · not a real customer",
   confirm="Confirm visit", confirmed="Visit confirmed",
   leadNotifTitle="TradeCatch · New request", leadRows=[("Caller","Sarah Lavoie"),("Callback","(450) 555-0143"),("Address","45 Laurier Ave, Laval"),("Request","Kitchen sink leak"),("Preferred time","Tomorrow, around 10 a.m.")],
   leadNotifBodyA="Kitchen sink leak · 45 Laurier Ave, Laval", outcomeLabel="Appointment request", outcome="Waiting for your team to confirm",
   leadNotifBodyB="Kitchen outlet not working · Laval", leadRowsB=[("Contact","(450) 555-0187"),("Address","45 Laurier Ave, Laval"),("Request","Kitchen outlet not working"),("Preferred time","Thursday afternoon")], outcomeB="Waiting for your team to confirm",
   pill="TradeCatch · Emergency transfer", number2="(514) 555-0162", reason="Basement flooding", via="Transferred from the NorthStar Plumbing line", connected="Connected",
   cNotifTitle="TradeCatch · Emergency call", cNotifBody="Basement flooding · transferred to on-call", cSheetTitle="Overnight summary",
   cRows=[("Emergency · 9:48 p.m.","Basement flooding. Transferred to your on-call line.","#ff9a8b"),("After-hours message · 10:26 p.m.","Dripping tap. Callback requested tomorrow morning.")],
   cOutcomeLabel="Summary ready", cOutcome="Every call, in one place", cBtn="Open workspace",
   smsContact="NorthStar Electric", smsStamp="Today 2:14 PM",
   sms=[("biz","Hi, this is NorthStar Electric. Sorry we missed your call! How can we help?"),
        ("cust","Hi! The outlet in my kitchen stopped working. Can you come by this week?"),
        ("biz","Yes, we can help with that. What's your address, and what day works best?"),
        ("cust","45 Laurier Ave, Laval. Thursday afternoon?"),
        ("biz","Got it. I've passed your request to the team. They'll confirm your time shortly.")],
 ),
 "fr": dict(
   date="mardi 11 mars", dateNext="mercredi 12 mars", decline="Refuser", accept="Répondre", missedTitle="Appel manqué", now="maintenant", sub="Laval, QC",
   bizPlumb="Plomberie NorthStar", bizElec="Électricité NorthStar",
   calling="appel en cours...", ended="Appel terminé", mute="muet", keypad="clavier", speaker="haut-parleur", add="ajouter", video="vidéo", contacts="contacts",
   connecting="connexion...", query="plombier près de moi", resultsTitle="PLOMBIERS PRÈS DE VOUS",
   co1="Plomberie NorthStar", co1meta="Laval  ·  1,2 km", noAnswer="Aucune réponse", co2="Laval Tuyaux et Drains", co2meta="Ouvert  ·  2,1 km", callBtn="Appeler",
   co3="Plomberie Rapide Laval", co3meta="Ouvert  ·  3,4 km",
   sheetTitle="Résumé d'appel", sheetTitleB="Résumé de la demande", badge="Exemple de résumé · pas un vrai client",
   confirm="Confirmer la visite", confirmed="Visite confirmée",
   leadNotifTitle="TradeCatch · Nouvelle demande", leadRows=[("Appelant","Sarah Lavoie"),("Rappel","(450) 555-0143"),("Adresse","45, av. Laurier, Laval"),("Demande","Fuite sous l'évier de cuisine"),("Heure souhaitée","Demain, vers 10 h")],
   leadNotifBodyA="Fuite sous l'évier · 45, av. Laurier, Laval", outcomeLabel="Demande de rendez-vous", outcome="En attente de confirmation par l'équipe",
   leadNotifBodyB="Prise de cuisine hors service · Laval", leadRowsB=[("Contact","(450) 555-0187"),("Adresse","45, av. Laurier, Laval"),("Demande","Prise de cuisine hors service"),("Heure souhaitée","Jeudi après-midi")], outcomeB="En attente de confirmation par l'équipe",
   pill="TradeCatch · Transfert d'urgence", number2="(514) 555-0162", reason="Sous-sol inondé", via="Transféré depuis la ligne de Plomberie NorthStar", connected="Connecté",
   cNotifTitle="TradeCatch · Appel d'urgence", cNotifBody="Sous-sol inondé · transféré à la garde", cSheetTitle="Résumé de la nuit",
   cRows=[("Urgence · 21 h 48","Sous-sol inondé. Transféré à votre ligne de garde.","#ff9a8b"),("Message hors heures · 22 h 26","Robinet qui goutte. Rappel demandé demain matin.")],
   cOutcomeLabel="Résumé prêt", cOutcome="Tous vos appels, au même endroit", cBtn="Ouvrir l'espace de travail",
   smsContact="Électricité NorthStar", smsStamp="Aujourd'hui 14 h 14",
   sms=[("biz","Bonjour, ici Électricité NorthStar. Désolé d'avoir manqué votre appel! Comment peut-on vous aider?"),
        ("cust","Bonjour! La prise de ma cuisine ne fonctionne plus. Pouvez-vous passer cette semaine?"),
        ("biz","Oui, on peut vous aider. Quelle est votre adresse, et quel jour vous convient?"),
        ("cust","45, av. Laurier, Laval. Jeudi après-midi?"),
        ("biz","Reçu. J'ai transmis votre demande à l'équipe. Elle confirmera l'heure sous peu.")],
 ),
}

def brand(lang):
    return C.BRAND[lang]

def spec_incoming(lang, dur, miss_at, number="(450) 555-0143", time="2:14"):
    s = STR[lang]
    return dict(type="incoming", dur=dur, fps=C.FPS, time=time, clock=time, date=s["date"], number=number, sub=s["sub"],
                decline=s["decline"], accept=s["accept"], missedTitle=s["missedTitle"], now=s["now"], missAt=miss_at)

def spec_calling(lang, dur, end_at, search_at, tap_at):
    s = STR[lang]
    return dict(type="calling", dur=dur, fps=C.FPS, time="2:13", name=s["bizPlumb"], calling=s["calling"], ended=s["ended"],
                mute=s["mute"], keypad=s["keypad"], speaker=s["speaker"], query=s["query"], resultsTitle=s["resultsTitle"],
                co1=s["co1"], co1meta=s["co1meta"], noAnswer=s["noAnswer"], co2=s["co2"], co2meta=s["co2meta"], callBtn=s["callBtn"],
                co3=s["co3"], co3meta=s["co3meta"], endAt=end_at, searchAt=search_at, tapAt=tap_at, tapXY=[880, 1018])

def spec_live(lang, dur, env_recep, env_cust, env_fps, connect_at=0.5, name_key="bizPlumb", time="2:13", timer_start=0):
    s = STR[lang]
    return dict(type="live", dur=dur, fps=C.FPS, time=time, name=s[name_key], mute=s["mute"], keypad=s["keypad"], speaker=s["speaker"],
                add=s["add"], video=s["video"], contacts=s["contacts"], connecting=s["connecting"], connectAt=connect_at,
                timerStart=timer_start, envFps=env_fps, envRecep=env_recep, envCust=env_cust)

def spec_sms(lang, dur, times):
    """times: list of dicts per message: at, typingAt(biz), typeStart/typeEnd(cust)"""
    s = STR[lang]
    msgs = []
    for (who, text), t in zip(s["sms"], times):
        m = dict(from_=who, text=text); m["from"] = who; m.pop("from_")
        m.update(t); msgs.append(m)
    return dict(type="sms", dur=dur, fps=C.FPS, time="2:14", contact=s["smsContact"], stamp=s["smsStamp"], msgs=msgs, taps=[])

def spec_lead(lang, dur, notif_at, tap_notif_at, card_at, outcome_at, confirm_tap_at=None, variant="A", time="2:19", date=None):
    s = STR[lang]
    if variant == "A":
        rows = [(a, b) for a, b in s["leadRows"]]; nb = s["leadNotifBodyA"]; oc = s["outcome"]
        d = dict(notifTitle=s["leadNotifTitle"], notifBody=nb, sheetTitle=s["sheetTitle"], sheetSub=s["bizPlumb"], rows=rows,
                 outcomeLabel=s["outcomeLabel"], outcome=oc, confirm=s["confirm"], confirmed=s["confirmed"])
    elif variant == "B":
        rows = [(a, b) for a, b in s["leadRowsB"]]
        d = dict(notifTitle=s["leadNotifTitle"], notifBody=s["leadNotifBodyB"], sheetTitle=s["sheetTitleB"], sheetSub=s["bizElec"], rows=rows,
                 outcomeLabel=s["outcomeLabel"], outcome=s["outcomeB"], confirm=s["confirm"], confirmed=s["confirmed"])
    else:  # "C" overnight
        rows = [tuple(r) for r in s["cRows"]]
        d = dict(notifTitle=s["cNotifTitle"], notifBody=s["cNotifBody"], sheetTitle=s["cSheetTitle"], sheetSub=s["bizPlumb"], rows=rows,
                 outcomeLabel=s["cOutcomeLabel"], outcome=s["cOutcome"], confirm=s["cBtn"], confirmed=s["cBtn"])
    d.update(type="lead", dur=dur, fps=C.FPS, time=time, clock=time, date=date or s["date"], now=s["now"], badge=s["badge"],
             notifAt=notif_at, tapNotifAt=tap_notif_at, cardAt=card_at, outcomeAt=outcome_at, confirmTapAt=confirm_tap_at,
             rowGap=0.22)
    return d

def spec_transfer(lang, dur, answer_at, time="9:48"):
    s = STR[lang]
    return dict(type="transfer", dur=dur, fps=C.FPS, time=time, pill=s["pill"], number=s["number2"], reason=s["reason"], via=s["via"],
                connected=s["connected"], decline=s["decline"], accept=s["accept"], answerAt=answer_at)

def spec_end(lang, dur):
    b = brand(lang)
    return dict(type="end", dur=dur, fps=C.FPS, tag=b["tag"], cta=b["cta"], url=b["url"], legal=b["legal"])
