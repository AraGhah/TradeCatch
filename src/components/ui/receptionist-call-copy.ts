import type { ReceptionistCallCopy } from "@/components/ui/receptionist-call-phone";

/**
 * The hero phone's call, assembled from the `productPreview` messages for the
 * launch flags in force. This is where the page decides what it promises:
 * booking only once scheduling is verified, a live connection to the owner
 * only once the operator has switched call transfer on. Otherwise the same
 * call ends the way the product handles it in that mode: a request the team
 * confirms, and a callback flagged for the owner.
 *
 * `t` resolves keys inside `productPreview`. Pure, so tests can run every flag
 * combination against both locales.
 */
export function receptionistCallCopy(
  t: (key: string) => string,
  { booking, transfer }: { booking: boolean; transfer: boolean },
): ReceptionistCallCopy {
  const v = (key: string) => t(`voice.${key}`);

  const lines: ReceptionistCallCopy["lines"] = [
    { who: "agent", text: v("lineGreet") },
    { who: "caller", text: v("lineNeed") },
    { who: "agent", text: v("lineProbe") },
    { who: "caller", text: v("lineUrgency") },
    { who: "agent", text: v("lineAskDetails") },
    { who: "caller", text: v("lineDetails") },
  ];
  const workStart = lines.length;
  let offer: number | null = null;
  if (booking) {
    lines.push({ who: "agent", text: v("lineCheckBooked") });
    offer = lines.length;
    lines.push({ who: "agent", text: v("lineOfferBooked") });
  } else {
    lines.push({ who: "agent", text: v("lineAskRequest") });
  }
  const pick = lines.length;
  lines.push({
    who: "caller",
    text: booking ? v("linePickBooked") : v("linePickRequest"),
  });
  const workEnd = lines.length;
  lines.push({
    who: "agent",
    text: booking ? v("lineConfirmBooked") : v("lineConfirmRequest"),
  });
  lines.push({ who: "caller", text: v("lineAskOwner") });
  const handoff = lines.length;
  lines.push({
    who: "agent",
    text: transfer ? v("transfer.line") : v("lineCallback"),
  });

  return {
    screenLabel: v("screenLabel"),
    summaryText: [
      v("summaryIntro"),
      booking ? v("summaryBooked") : v("summaryRequest"),
      transfer ? v("transfer.summary") : v("summaryCallback"),
      v("summaryEnd"),
    ].join(" "),
    incoming: v("incoming"),
    line: v("line"),
    caller: v("caller"),
    callerLine: v("callerLine"),
    answering: v("answering"),
    answered: v("answered"),
    onCall: v("onCall"),
    onHold: v("onHold"),
    callEnded: v("callEnded"),
    speakerAgent: v("speakerAgent"),
    speakerCaller: v("speakerCaller"),
    lines,
    marks: {
      need: 1,
      urgency: 3,
      details: 5,
      workStart,
      offer,
      pick,
      workEnd,
      handoff,
    },
    detailsTitle: v("detailsTitle"),
    fields: [
      [v("fieldNeed"), v("fieldNeedValue")],
      [v("fieldUrgency"), v("fieldUrgencyValue")],
      [v("fieldName"), v("fieldNameValue")],
      [v("fieldAddress"), v("fieldAddressValue")],
      [v("fieldPhone"), v("fieldPhoneValue")],
    ],
    work: booking
      ? {
          title: [
            v("calChecking"),
            v("calFound"),
            v("calPicked"),
            v("calBooked"),
          ],
          items: [v("slot1"), v("slot2"), v("slot3")],
          busy: v("slotBusy"),
        }
      : {
          title: [v("reqTitle"), v("reqNoted"), v("reqSent"), v("reqSent")],
          items: [v("reqNeed"), v("reqPrefers"), v("reqConfirm")],
          busy: "",
        },
    handoff: transfer
      ? {
          title: [v("transfer.title"), v("transfer.done")],
          rows: [
            v("transfer.ringing"),
            v("transfer.briefing"),
            v("transfer.connected"),
          ],
        }
      : {
          title: [v("callbackTitle"), v("callbackDone")],
          rows: [v("callbackTopic"), v("callbackNumber"), v("callbackFlag")],
        },
    notifyApp: v("notifyApp"),
    notifyNow: v("notifyNow"),
    notifyTitle: v("notifyTitle"),
    notifyBody: booking ? v("notifyBodyBooked") : v("notifyBodyRequest"),
    appTitle: v("appTitle"),
    appToday: v("appToday"),
    summaryTitle: v("summaryTitle"),
    summaryBy: v("summaryBy"),
    rows: [
      [v("rowCustomer"), v("rowCustomerValue")],
      [v("rowNeed"), v("rowNeedValue")],
      [v("rowAddress"), v("rowAddressValue")],
      [
        v("rowOutcome"),
        booking ? v("rowOutcomeBooked") : v("rowOutcomeRequest"),
      ],
      [v("rowNext"), transfer ? v("transfer.next") : v("rowNextCallback")],
    ],
    outcomeRow: 3,
    // Texting complements the call: a confirmation text follows a booking.
    chips: booking
      ? [v("chipTranscript"), v("chipConfirmation")]
      : [v("chipTranscript")],
    earlier: [v("earlier"), v("earlierTime")],
    noticeLeft: v("noticeLeft"),
    noticeRight: v("noticeRight"),
    pause: t("pause"),
    play: t("play"),
  };
}
