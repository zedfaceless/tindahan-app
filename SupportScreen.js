// SupportScreen.js
// Help and support. Vendors open tickets with a topic, a message, an optional
// screenshot, and an optional link to one of their payment or statement requests,
// then talk with the Tindahan owner in each ticket's thread.
// The owner's status shows at the top, Available while the admin is open, Away
// otherwise. First replies come within 2 to 24 hours.

import { useState, useEffect, useMemo } from "react";
import { StyleSheet, Text, View, TextInput, TouchableOpacity, Image, ActivityIndicator } from "react-native";
import * as ImagePicker from "expo-image-picker";
import { supabase } from "./lib/supabase";
import { notify, confirmAction } from "./lib/notify";
import { useTheme, EMERALD, INDIGO } from "./lib/theme";
import { base64ToBytes } from "./lib/exportPdf";

const BUCKET = "ticket-screenshots";
const MAX_BYTES = 5 * 1024 * 1024;

const TOPICS = [
  ["payment", "Payment, premium"],
  ["statement", "Statement, PDF"],
  ["app", "App problem"],
  ["account", "Account, login"],
  ["other", "Other"],
];
const TOPIC_LABEL = Object.fromEntries(TOPICS);

const STATUS = {
  open: ["Open, naghihintay", "accent"],
  in_progress: ["Being handled", "accent"],
  waiting: ["Waiting for your reply", "bad"],
  solved: ["Solved", "good"],
  closed: ["Closed", "muted"],
};

function when(value) {
  const d = new Date(value);
  return d.toLocaleDateString("en-PH", { month: "short", day: "numeric" }) + ", "
    + (d.getHours() % 12 === 0 ? 12 : d.getHours() % 12) + ":" + String(d.getMinutes()).padStart(2, "0")
    + (d.getHours() < 12 ? " AM" : " PM");
}

export default function SupportScreen({ user, header, onBack, onChanged }) {
  const { colors, mode: theme } = useTheme();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [view, setView] = useState("list");
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  // true when tickets could not load, usually no internet, so the list is never shown as empty by mistake
  const [offline, setOffline] = useState(false);
  // the open ticket and its thread
  const [ticket, setTicket] = useState(null);
  const [messages, setMessages] = useState([]);
  const [images, setImages] = useState({});
  const [reply, setReply] = useState("");
  // the new ticket form
  const [topic, setTopic] = useState("app");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [related, setRelated] = useState(null);
  const [relatedOptions, setRelatedOptions] = useState([]);
  // a picked screenshot, for a new ticket or a reply
  const [shot, setShot] = useState(null);

  async function loadList() {
    setLoading(true);
    const [list, status] = await Promise.all([
      supabase.from("tickets")
        .select("id, number, subject, topic, status, priority, updated_at, last_staff_message_at, vendor_read_at, related_type, related_id")
        .order("updated_at", { ascending: false }),
      supabase.rpc("support_available"),
    ]);
    setLoading(false);
    setOffline(Boolean(list.error));
    if (!list.error) setTickets(list.data);
    setAvailable(Boolean(status.data));
  }

  useEffect(() => {
    loadList();
  }, []);

  // while a ticket is open, check for new replies every 10 seconds
  useEffect(() => {
    if (view !== "thread" || !ticket) return undefined;
    const timer = setInterval(() => loadThread(ticket.id, false), 10000);
    return () => clearInterval(timer);
  }, [view, ticket]);

  async function loadThread(id, markRead) {
    const { data, error } = await supabase.from("ticket_messages")
      .select("id, author_role, body, attachment_path, created_at")
      .eq("ticket_id", id)
      .order("created_at", { ascending: true });
    setOffline(Boolean(error));
    if (error) return;
    setMessages(data);
    const paths = data.map((m) => m.attachment_path).filter((p) => p && !images[p]);
    if (paths.length) {
      const signed = await supabase.storage.from(BUCKET).createSignedUrls(paths, 3600);
      if (!signed.error) {
        setImages((old) => {
          const next = { ...old };
          signed.data.forEach((s) => { if (s.signedUrl) next[s.path] = s.signedUrl; });
          return next;
        });
      }
    }
    const fresh = await supabase.from("tickets").select("*").eq("id", id).single();
    if (!fresh.error) setTicket(fresh.data);
    if (markRead) {
      await supabase.rpc("vendor_mark_read", { ticket: id });
      if (onChanged) onChanged();
    }
  }

  function openTicket(t) {
    setTicket(t);
    setMessages([]);
    setReply("");
    setShot(null);
    setView("thread");
    loadThread(t.id, true);
  }

  // the vendor's recent payment and statement requests, to link to a ticket
  async function openNew() {
    setTopic("app");
    setSubject("");
    setBody("");
    setRelated(null);
    setShot(null);
    setView("new");
    const [payments, statements] = await Promise.all([
      supabase.from("premium_requests").select("id, plan, amount, reference_number, created_at, status")
        .order("created_at", { ascending: false }).limit(5),
      supabase.from("statement_requests").select("id, period_start, period_end, created_at, status")
        .order("created_at", { ascending: false }).limit(5),
    ]);
    const options = [];
    (payments.data || []).forEach((p) => options.push({
      type: "payment", id: p.id,
      label: "Payment, " + (p.plan === "annual" ? "annual" : "monthly") + ", ref " + p.reference_number + ", " + p.status,
    }));
    (statements.data || []).forEach((s) => options.push({
      type: "statement", id: s.id,
      label: "Statement, " + s.period_start + " to " + s.period_end + ", " + s.status,
    }));
    setRelatedOptions(options);
  }

  // pick a screenshot from the phone, kept small so it uploads on slow signal
  async function pickShot() {
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ["images"], quality: 0.5, base64: true,
    });
    if (result.canceled || !result.assets || !result.assets[0]) return;
    const asset = result.assets[0];
    const mime = asset.mimeType || "image/jpeg";
    if (!["image/jpeg", "image/png", "image/webp"].includes(mime)) {
      notify("Use a photo or screenshot", "Please pick a JPG, PNG, or WEBP picture.");
      return;
    }
    if (!asset.base64 || asset.base64.length * 0.75 > MAX_BYTES) {
      notify("Picture too big", "Please pick a picture smaller than 5 MB.");
      return;
    }
    setShot({ uri: asset.uri, base64: asset.base64, mime: mime });
  }

  // upload the screenshot into the vendor's own folder, returns its path
  async function uploadShot() {
    if (!shot) return null;
    const ext = shot.mime === "image/png" ? "png" : shot.mime === "image/webp" ? "webp" : "jpg";
    const path = user.id + "/" + Date.now() + "." + ext;
    // a clean copy of just the picture's bytes, the form Supabase expects on phones
    const bytes = base64ToBytes(shot.base64);
    const data = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
    const { error } = await supabase.storage.from(BUCKET)
      .upload(path, data, { contentType: shot.mime, upsert: false });
    if (error) throw error;
    return path;
  }

  async function submitNew() {
    if (subject.trim().length < 3) {
      notify("Subject needed", "Write a short title, like Premium not showing.");
      return;
    }
    if (body.trim().length === 0) {
      notify("Message needed", "Tell us what happened.");
      return;
    }
    setBusy(true);
    try {
      const attachment = await uploadShot();
      const { data, error } = await supabase.rpc("create_ticket", {
        topic: topic, subject: subject.trim(), body: body.trim(),
        related_type: related ? related.type : null, related_id: related ? related.id : null,
        attachment: attachment,
      });
      if (error) throw error;
      await loadList();
      const created = await supabase.from("tickets").select("*").eq("id", data).single();
      notify("Ticket sent", "Your ticket is " + (created.data ? created.data.number : "saved")
        + ". The owner replies within 2 to 24 hours.");
      if (created.data) openTicket(created.data);
      else setView("list");
    } catch (error) {
      notify("Could not send", "Check your internet and try again. " + (error.message || ""));
    } finally {
      setBusy(false);
    }
  }

  async function sendReply() {
    if (reply.trim().length === 0 && !shot) return;
    setBusy(true);
    try {
      const attachment = await uploadShot();
      const { error } = await supabase.rpc("vendor_reply", {
        ticket: ticket.id, body: reply.trim() || "Screenshot attached", attachment: attachment,
      });
      if (error) throw error;
      setReply("");
      setShot(null);
      await loadThread(ticket.id, true);
    } catch (error) {
      notify("Could not send", error.message || "Check your internet and try again.");
    } finally {
      setBusy(false);
    }
  }

  function markSolved() {
    confirmAction("Is your problem solved?", "You can still reply within 7 days to reopen it.", "Yes, solved", async () => {
      const { error } = await supabase.rpc("vendor_mark_solved", { ticket: ticket.id });
      if (error) {
        notify("Could not update", error.message);
        return;
      }
      await loadThread(ticket.id, false);
    });
  }

  // ----- pieces -----

  function statusPill(status) {
    const [label, tone] = STATUS[status] || [status, "muted"];
    return <Text style={[styles.pill, styles["pill_" + tone]]}>{label}</Text>;
  }

  function availability() {
    return (
      <View style={styles.presence}>
        <View style={[styles.dot, available ? styles.dotOn : styles.dotOff]} />
        <Text style={styles.presenceText}>
          {available ? "Available, the owner is online now" : "The owner is away, replies come within 2 to 24 hours"}
        </Text>
      </View>
    );
  }

  // shown instead of an empty list when the tickets could not load
  function renderOffline(retry) {
    return (
      <View style={styles.offline}>
        <Text style={styles.offlineText}>
          Offline, could not load your tickets. Your tickets are safe, check your internet and try again.
        </Text>
        <TouchableOpacity style={styles.retry} onPress={retry}>
          <Text style={styles.retryText}>TRY AGAIN</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderShotPicker() {
    return (
      <View style={styles.shotRow}>
        {shot ? (
          <View style={styles.shotPicked}>
            <Image source={{ uri: shot.uri }} style={styles.shotThumb} />
            <TouchableOpacity onPress={() => setShot(null)}>
              <Text style={styles.link}>Remove picture</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <TouchableOpacity style={styles.shotButton} onPress={pickShot}>
            <Text style={styles.shotButtonText}>+ ADD SCREENSHOT</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  function renderList() {
    return (
      <View>
        {availability()}
        <TouchableOpacity style={styles.primary} onPress={openNew}>
          <Text style={styles.primaryText}>+ NEW TICKET</Text>
        </TouchableOpacity>
        <Text style={styles.section}>My tickets</Text>
        {loading && <ActivityIndicator color={colors.muted} />}
        {!loading && offline && renderOffline(loadList)}
        {!loading && !offline && tickets.length === 0 && (
          <Text style={styles.empty}>Wala pang ticket. If something is wrong, open a ticket and we will help.</Text>
        )}
        {tickets.map((t) => {
          const unread = t.last_staff_message_at && (!t.vendor_read_at || t.last_staff_message_at > t.vendor_read_at);
          return (
            <TouchableOpacity key={t.id} style={styles.ticket} onPress={() => openTicket(t)}>
              <View style={styles.ticketTop}>
                <Text style={styles.ticketNumber}>{t.number}</Text>
                {unread && <Text style={styles.newReply}>NEW REPLY</Text>}
              </View>
              <Text style={styles.ticketSubject}>{t.subject}</Text>
              <View style={styles.ticketBottom}>
                {statusPill(t.status)}
                <Text style={styles.meta}>{TOPIC_LABEL[t.topic]}, {when(t.updated_at)}</Text>
              </View>
            </TouchableOpacity>
          );
        })}
      </View>
    );
  }

  function renderNew() {
    return (
      <View style={styles.card}>
        <Text style={styles.cardTitle}>New ticket</Text>
        <Text style={styles.label}>Tungkol saan, topic</Text>
        <View style={styles.chips}>
          {TOPICS.map(([key, label]) => (
            <TouchableOpacity key={key} style={[styles.chip, topic === key && styles.chipOn]} onPress={() => setTopic(key)}>
              <Text style={[styles.chipText, topic === key && styles.chipTextOn]}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>
        <Text style={styles.label}>Subject</Text>
        <TextInput
          style={styles.input} value={subject} onChangeText={setSubject} maxLength={120}
          placeholder="halimbawa, Premium not showing yet"
          placeholderTextColor={colors.muted} keyboardAppearance={theme === "abyss" ? "dark" : "light"}
        />
        <Text style={styles.label}>Ano ang nangyari, what happened</Text>
        <TextInput
          style={[styles.input, styles.multiline]} value={body} onChangeText={setBody} multiline maxLength={4000}
          placeholder="Tell us the details, when it happened and what you tapped"
          placeholderTextColor={colors.muted} keyboardAppearance={theme === "abyss" ? "dark" : "light"}
        />
        {relatedOptions.length > 0 && (
          <View>
            <Text style={styles.label}>Related to, optional</Text>
            {relatedOptions.map((o) => {
              const on = related && related.type === o.type && related.id === o.id;
              return (
                <TouchableOpacity key={o.type + o.id} style={[styles.related, on && styles.relatedOn]}
                  onPress={() => setRelated(on ? null : o)}>
                  <Text style={[styles.relatedText, on && styles.chipTextOn]}>{o.label}</Text>
                </TouchableOpacity>
              );
            })}
          </View>
        )}
        {renderShotPicker()}
        <TouchableOpacity style={styles.primary} onPress={submitNew} disabled={busy}>
          <Text style={styles.primaryText}>{busy ? "SENDING..." : "SEND TICKET"}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setView("list")}>
          <Text style={styles.cancel}>Cancel</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderThread() {
    if (!ticket) return null;
    const canReply = ticket.status !== "closed";
    return (
      <View>
        <TouchableOpacity onPress={() => { setView("list"); loadList(); }}>
          <Text style={styles.link}>Back to my tickets</Text>
        </TouchableOpacity>
        <View style={styles.card}>
          <Text style={styles.ticketNumber}>{ticket.number}, {TOPIC_LABEL[ticket.topic]}</Text>
          <Text style={styles.cardTitle}>{ticket.subject}</Text>
          <View style={styles.ticketBottom}>{statusPill(ticket.status)}</View>
        </View>
        {availability()}
        {offline && renderOffline(() => loadThread(ticket.id, true))}
        {messages.map((m) => {
          const mine = m.author_role === "vendor";
          const bot = m.author_role === "bot";
          return (
            <View key={m.id} style={[styles.bubble, mine ? styles.bubbleMine : bot ? styles.bubbleBot : styles.bubbleStaff]}>
              <Text style={[styles.author, mine && styles.onStrong]}>
                {mine ? "Ikaw, you" : bot ? "Tindahan bot" : "Tindahan owner"}
              </Text>
              <Text style={[styles.message, mine && styles.onStrong]}>{m.body}</Text>
              {m.attachment_path && images[m.attachment_path] && (
                <Image source={{ uri: images[m.attachment_path] }} style={styles.attachment} resizeMode="cover" />
              )}
              <Text style={[styles.time, mine && styles.onStrong]}>{when(m.created_at)}</Text>
            </View>
          );
        })}
        {canReply ? (
          <View style={styles.card}>
            <TextInput
              style={[styles.input, styles.multiline]} value={reply} onChangeText={setReply} multiline maxLength={4000}
              placeholder={ticket.status === "solved" ? "Reply to reopen this ticket" : "Write a reply"}
              placeholderTextColor={colors.muted} keyboardAppearance={theme === "abyss" ? "dark" : "light"}
            />
            {renderShotPicker()}
            <TouchableOpacity style={styles.primary} onPress={sendReply} disabled={busy}>
              <Text style={styles.primaryText}>{busy ? "SENDING..." : "SEND REPLY"}</Text>
            </TouchableOpacity>
            {ticket.status !== "solved" && (
              <TouchableOpacity onPress={markSolved}>
                <Text style={styles.link}>My problem is solved</Text>
              </TouchableOpacity>
            )}
          </View>
        ) : (
          <Text style={styles.empty}>This ticket is closed. If you still need help, open a new ticket.</Text>
        )}
      </View>
    );
  }

  return (
    <View>
      {header}
      <TouchableOpacity onPress={onBack}>
        <Text style={styles.link}>Back to account</Text>
      </TouchableOpacity>
      {view === "list" && renderList()}
      {view === "new" && renderNew()}
      {view === "thread" && renderThread()}
    </View>
  );
}

function makeStyles(c) {
  return StyleSheet.create({
    link: { fontSize: 16, color: c.accent, fontWeight: "bold", marginTop: 12 },
    cancel: { fontSize: 16, color: c.muted, fontWeight: "bold", textAlign: "center", marginTop: 14 },
    presence: {
      flexDirection: "row", alignItems: "center", gap: 10, marginTop: 14,
      backgroundColor: c.card, borderRadius: 10, padding: 12, borderWidth: 1, borderColor: c.line,
    },
    dot: { width: 12, height: 12, borderRadius: 6 },
    dotOn: { backgroundColor: EMERALD },
    dotOff: { backgroundColor: c.muted },
    presenceText: { fontSize: 15, color: c.text, flexShrink: 1 },
    primary: { marginTop: 14, backgroundColor: EMERALD, padding: 16, borderRadius: 10, alignItems: "center" },
    primaryText: { fontSize: 17, fontWeight: "bold", color: "white" },
    section: { fontSize: 19, fontWeight: "bold", color: c.text, marginTop: 20 },
    empty: { fontSize: 16, color: c.muted, marginTop: 14 },
    offline: { marginTop: 14, backgroundColor: c.badSoft, borderRadius: 10, padding: 14 },
    offlineText: { fontSize: 15, color: c.bad, fontWeight: "bold" },
    retry: { marginTop: 10, alignSelf: "flex-start", borderWidth: 2, borderColor: c.bad, borderRadius: 8, paddingVertical: 8, paddingHorizontal: 14 },
    retryText: { fontSize: 14, fontWeight: "bold", color: c.bad },
    ticket: { backgroundColor: c.card, borderRadius: 12, padding: 14, marginTop: 10, borderWidth: 1, borderColor: c.line },
    ticketTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    ticketNumber: { fontSize: 13, fontWeight: "bold", color: c.muted, letterSpacing: 1 },
    newReply: { fontSize: 12, fontWeight: "bold", color: "white", backgroundColor: INDIGO, paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
    ticketSubject: { fontSize: 18, fontWeight: "bold", color: c.text, marginTop: 4 },
    ticketBottom: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
    meta: { fontSize: 13, color: c.muted },
    pill: { fontSize: 12, fontWeight: "bold", paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6, overflow: "hidden" },
    pill_accent: { color: c.accent, backgroundColor: c.accentSoft },
    pill_bad: { color: c.bad, backgroundColor: c.badSoft },
    pill_good: { color: c.good, backgroundColor: c.goodSoft },
    pill_muted: { color: c.muted, backgroundColor: c.subtle },
    card: { backgroundColor: c.card, borderRadius: 12, padding: 16, marginTop: 14, borderWidth: 1, borderColor: c.line },
    cardTitle: { fontSize: 21, fontWeight: "bold", color: c.text, marginTop: 2 },
    label: { fontSize: 16, color: c.muted, marginTop: 14, marginBottom: 6 },
    input: {
      backgroundColor: c.card, borderRadius: 10, padding: 12, color: c.text,
      fontSize: 18, borderWidth: 1, borderColor: c.line,
    },
    multiline: { minHeight: 110, textAlignVertical: "top" },
    chips: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
    chip: { paddingVertical: 9, paddingHorizontal: 12, borderRadius: 18, borderWidth: 2, borderColor: c.line, backgroundColor: c.card },
    chipOn: { backgroundColor: c.strong, borderColor: c.strong },
    chipText: { fontSize: 14, fontWeight: "bold", color: c.text },
    chipTextOn: { color: c.onStrong },
    related: { padding: 12, borderRadius: 10, borderWidth: 2, borderColor: c.line, marginTop: 6 },
    relatedOn: { backgroundColor: c.strong, borderColor: c.strong },
    relatedText: { fontSize: 14, color: c.text },
    shotRow: { marginTop: 14 },
    shotButton: { padding: 12, borderRadius: 10, borderWidth: 2, borderColor: c.line, borderStyle: "dashed", alignItems: "center" },
    shotButtonText: { fontSize: 15, fontWeight: "bold", color: c.accent },
    shotPicked: { flexDirection: "row", alignItems: "center", gap: 12 },
    shotThumb: { width: 72, height: 72, borderRadius: 8 },
    // the conversation
    bubble: { borderRadius: 14, padding: 12, marginTop: 10, maxWidth: "88%" },
    bubbleMine: { backgroundColor: c.strong, alignSelf: "flex-end" },
    bubbleStaff: { backgroundColor: c.card, borderWidth: 1, borderColor: c.line, alignSelf: "flex-start" },
    bubbleBot: { backgroundColor: c.accentSoft, alignSelf: "flex-start" },
    author: { fontSize: 12, fontWeight: "bold", color: c.muted, marginBottom: 4 },
    message: { fontSize: 16, color: c.text },
    onStrong: { color: c.onStrong },
    time: { fontSize: 11, color: c.muted, marginTop: 6 },
    attachment: { width: 220, height: 220, borderRadius: 10, marginTop: 8 },
  });
}
