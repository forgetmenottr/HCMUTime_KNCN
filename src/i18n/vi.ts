import type { Day, ParseWarningCode } from "../lib/parser";
import type { ConstraintName, SolverDiagnosticCode } from "../lib/solver";
import type { TimeWarningCode } from "../lib/timing";
import { blank, clip, groupId, groupKey, ownRequired } from "./helpers";
import type { Dictionary, Fmt, HalfDay, Message, NameKey, Params } from "./types";

/**
 * Labels for constraint names, as they appear in `violations[].item`,
 * `relaxed[]` and `params.constraints`. Each one is the name of the control the
 * student sees, so a message points at something they can find on the screen.
 */
const constraint = {
  programs: "Chương trình đào tạo",
  // Both day constraints read as the one merged control; daysOff has no control of its own.
  partsOff: "Ngày/buổi nghỉ",
  daysOff: "Ngày/buổi nghỉ",
  // The control's own label (B2); the longer sentence "Chỉ chọn lớp còn chỗ…" is its tooltip.
  freeSeats: "Còn chỗ trống",
  // No control on the screen. These are always sent "off", so they never reach a message;
  // the labels exist so that a bug still reads sensibly (and is reported as "unexpected").
  campuses: "Cơ sở",
  language: "Ngôn ngữ giảng dạy",
  avoidLecturers: "Tránh giảng viên",
} satisfies Record<ConstraintName, string>;

/** "Thứ 2" … as in the pasted data, which students already read. */
const dayLong = {
  2: "Thứ 2",
  3: "Thứ 3",
  4: "Thứ 4",
  5: "Thứ 5",
  6: "Thứ 6",
  7: "Thứ 7",
  8: "Chủ nhật",
} satisfies Record<Day, string>;

const dayShort = {
  2: "T2",
  3: "T3",
  4: "T4",
  5: "T5",
  6: "T6",
  7: "T7",
  8: "CN",
} satisfies Record<Day, string>;

/** Rows of the "Ngày/buổi nghỉ" grid: a half-day the student wants off. */
const partOff = {
  morning: "Sáng",
  afternoon: "Chiều",
} satisfies Record<HalfDay, string>;

/**
 * Choices of "Bạn thích học buổi nào?": a half-day the student wants to study in.
 * Same words as `partOff` in Vietnamese, but a separate key so either can be
 * reworded without changing the other (the intent is opposite).
 */
const partStudy = {
  morning: "Sáng",
  afternoon: "Chiều",
} satisfies Record<HalfDay, string>;

/** Campus names; the proper names stay as they are in both languages. */
const campus = {
  1: "CS1 – Lý Thường Kiệt",
  2: "CS2 – Dĩ An",
} satisfies Record<1 | 2, string>;

/** Session kind, as the parser guesses it from the weeks (`Session.kind`). */
const kind = {
  theory: "Lý thuyết",
  lab: "Thực hành",
} satisfies Record<"theory" | "lab", string>;

/**
 * Parse warnings, about the pasted data. The reader is fixing their paste:
 * each message says what is wrong, what happened to the data (skipped or
 * kept), and what to do. The UI shows "Dòng {line}" in front of each one
 * (paste.line), so the messages do not repeat the line number.
 */
const parse = {
  "internal-error": (p, f) =>
    `Ứng dụng gặp lỗi khi đọc dòng này, nên dòng này có thể chưa được đọc đúng. Đây là lỗi của ứng dụng, không phải của dữ liệu bạn dán. (Chi tiết: ${clip(f.str(p.error))})`,
  "unrecognized-line":
    "Không đọc được dòng này nên đã bỏ qua. Nếu dòng này không thuộc bảng môn học, bạn không cần làm gì.",
  "group-before-course":
    "Nhóm lớp này nằm trước tên môn nên đã bị bỏ qua. Hãy sao chép cả dòng tên môn (dạng “CO2007 - Tên môn”) phía trên bảng nhóm lớp.",
  "invalid-group-id": (p, f) =>
    `Mã nhóm lớp “${clip(f.str(p.id), 40)}” không đúng dạng (ví dụ A01 hoặc A01_A01), nên cả nhóm lớp bị bỏ qua.`,
  "missing-registered-capacity":
    "Nhóm lớp này thiếu số đã đăng ký / sĩ số (dạng 34/40), nên cả nhóm lớp bị bỏ qua. Hãy sao chép lại môn này.",
  "missing-language": "Nhóm lớp này thiếu ngôn ngữ giảng dạy (V hoặc TA). Nhóm lớp vẫn được dùng để xếp lịch.",
  "session-without-group":
    "Buổi học này không thuộc nhóm lớp nào đọc được nên đã bị bỏ qua. Thường là do dòng nhóm lớp phía trên bị lỗi: hãy sửa dòng đó trước.",
  // A skipped session leaves its group with one session fewer, so the group can be
  // picked into a schedule that clashes in reality. Each message says so.
  "session-no-day":
    "Buổi học này thiếu thứ, nên bị bỏ qua và nhóm lớp sẽ thiếu buổi này khi xếp lịch. Hãy sao chép lại môn này.",
  "session-no-room":
    "Buổi học này thiếu phòng (dạng C5-202), nên bị bỏ qua và nhóm lớp sẽ thiếu buổi này khi xếp lịch. Hãy sao chép lại môn này.",
  "session-no-weeks":
    "Buổi học này thiếu chuỗi tuần học, nên bị bỏ qua và nhóm lớp sẽ thiếu buổi này khi xếp lịch. Hãy sao chép lại môn này.",
  "session-no-periods":
    "Buổi học này không có tiết nào, nên bị bỏ qua và nhóm lớp sẽ thiếu buổi này khi xếp lịch. Hãy sao chép lại môn này.",
  // Periods are read from the numbers written on the line, not from their columns (decodePeriods).
  "period-column-count": (p, f) =>
    `Phần tiết học có ${f.num(p.found)} cột thay vì ${f.num(p.expected)}. Các tiết vẫn được đọc theo số ghi trên dòng; hãy đối chiếu lại với trang Đăng ký môn học.`,
  "period-misplaced":
    "Có số tiết không nằm đúng cột của nó. Các tiết vẫn được đọc theo số ghi trên dòng; hãy đối chiếu lại với trang Đăng ký môn học.",
  // Weeks are read from the position of each digit, not from the digit (decodeWeeks).
  "week-digit-mismatch": (p, f) =>
    `Chuỗi tuần học có chữ số không khớp ở tuần ${f.runs(p.weeks)}; các tuần đã được đọc theo vị trí. Hãy đối chiếu lại với trang Đăng ký môn học.`,
  "unknown-campus": (p, f) =>
    blank(p.campus)
      ? "Buổi học này thiếu cơ sở (1 hoặc 2). Buổi học vẫn được dùng để xếp lịch."
      : `Cơ sở “${clip(f.str(p.campus), 40)}” không phải 1 hoặc 2. Buổi học vẫn được dùng để xếp lịch.`,
  // An empty weeks set gives an empty time mask: the session never clashes with anything.
  "no-teaching-week":
    "Chuỗi tuần học không có tuần nào, nên buổi học này không được tính khi xếp lịch. Hãy đối chiếu lại với trang Đăng ký môn học.",
  "no-courses-found": "Không tìm thấy môn học nào trong nội dung đã dán.", // §5
} satisfies Record<ParseWarningCode, Message>;

/** "Thứ 2, tiết 2–4, phòng A4-409": one session, as the student sees it on screen 2. */
function session(p: Params, f: Fmt): string {
  return `${f.day(p.day)}, tiết ${f.runs(p.sessionPeriods)}, phòng ${f.str(p.room)}`;
}

/**
 * Timing warnings, about the pasted data, shown on the course or group row of
 * screen 2 (tooltip title: courses.warningTitle). Course and group come from
 * the warning itself (`courseCode`, `groupId`). `slots-out-of-range.count`
 * counts week × period cells, which mean nothing to a student, so it is not shown.
 */
const timing = {
  "duplicate-course": "Môn {courseCode} được dán hơn một lần; ứng dụng dùng bản dán sau cùng.",
  "duplicate-group": "Nhóm lớp {groupId} của môn {courseCode} xuất hiện hơn một lần; ứng dụng dùng bản sau cùng.",
  // A cell is dropped when its week or period is out of range (bitIndex); the day is always 2..8.
  // With every period in range, the cause can only be a week after maxWeek.
  "slots-out-of-range": (p, f) => {
    const limit = typeof p.periods === "number" ? p.periods : 16;
    const periods = Array.isArray(p.sessionPeriods) ? p.sessionPeriods : [];
    const periodOut = periods.some((n) => typeof n !== "number" || n < 1 || n > limit);
    return periodOut
      ? `Buổi ${session(p, f)} có tiết nằm ngoài tiết 1–${f.num(p.periods)}; các tiết đó không được tính khi xếp lịch. Hãy đối chiếu lại với trang Đăng ký môn học.`
      : `Buổi ${session(p, f)} có tuần học sau tuần ${f.num(p.maxWeek)}; các tuần đó không được tính khi xếp lịch. Hãy đối chiếu lại với trang Đăng ký môn học.`;
  },
  // `session` / `other` are positions in the pasted list; "buổi thứ 2" would read like a day name, so they are not shown.
  "internal-overlap": (p, f) =>
    `Buổi ${session(p, f)} trùng giờ với một buổi khác của cùng nhóm lớp ${f.str(p.groupId)}. Lịch vẫn được xếp, nhưng hãy đối chiếu lại với trang Đăng ký môn học.`,
  "group-no-sessions":
    "Nhóm lớp {groupId} của môn {courseCode} không có buổi học nào đọc được, nên lịch xếp ra có thể không đúng với nhóm này. Hãy sao chép lại môn này.",
} satisfies Record<TimeWarningCode, Message>;

/**
 * Solver diagnostics, shown in the result banner. The reader is choosing what
 * to change in their own settings: each message says what blocked the
 * schedule and which choice to loosen. Constraint names go through
 * `fmt.constraint`, lock / exclude through `fmt.name`. Mode names ("Bắt buộc",
 * "Ưu tiên") are written as on the mode selector (prefs.mode.*); a test checks
 * that they match. `relaxed.weight` and `truncated.maxNodes` are never shown.
 */
const solver = {
  "no-courses": "Bạn chưa chọn môn nào để xếp lịch. Hãy chọn ít nhất một môn ở bước “Môn và lớp”.",
  // Internal guard (isConflictFree): a bug, not something the student did.
  "dropped-conflicting": (p, f) =>
    `Có ${f.num(p.count)} phương án bị loại vì lần kiểm tra cuối phát hiện trùng giờ. Đây là lỗi của ứng dụng; các phương án được hiển thị vẫn không trùng giờ.`,
  // `constraints` never contains "programs" here: that one has its own code, course-no-program.
  "course-blocked": (p, f) =>
    `Không lớp nào của môn ${f.str(p.course)} đáp ứng ${f.list(p.constraints, f.constraint)} (đang đặt Bắt buộc). Hãy nới bớt lựa chọn, hoặc chuyển sang Ưu tiên.`,
  // Each constraint alone leaves a group, so at least two are listed, and at least one is the student's own.
  "course-blocked-combined": (p, f) =>
    ownRequired(p.constraints).length === 0
      ? `Không lớp nào của môn ${f.str(p.course)} đáp ứng cùng lúc ${f.list(p.constraints, f.constraint)}.`
      : `Không lớp nào của môn ${f.str(p.course)} đáp ứng cùng lúc ${f.list(p.constraints, f.constraint)}. Hãy chuyển ${f.list(ownRequired(p.constraints), f.constraint)} sang Ưu tiên.`,
  "no-combination-required": (p, f) =>
    ownRequired(p.constraints).length === 0
      ? "Các lớp thuộc chương trình đào tạo của bạn không ghép được thành lịch nào mà không trùng giờ. Hãy bỏ bớt một môn."
      : `Không có cách ghép lớp nào vừa không trùng giờ vừa đáp ứng ${f.list(p.constraints, f.constraint)}. Hãy chuyển ${f.list(ownRequired(p.constraints), f.constraint)} sang Ưu tiên, hoặc bỏ bớt một môn.`,
  // Same words as results.noProgram + results.noProgramWhy, which the result screen shows for this code (A4).
  "course-no-program": (p, f) =>
    `Môn ${f.str(p.course)} không còn lớp nào thuộc chương trình ${f.list(p.allowed)}. Môn này chỉ còn lớp của chương trình ${f.list(p.available)}.`,
  relaxed: (p, f) =>
    `Không có lịch nào đáp ứng đủ ${f.list(p.constraints, f.constraint)}, nên các phương án dưới đây có thể vi phạm. Chỗ vi phạm được ghi ở từng phương án.`,
  "course-no-groups":
    "Môn {course} không có nhóm lớp nào đọc được từ dữ liệu đã dán. Hãy dán lại môn này, hoặc bỏ chọn “Xếp lịch cho môn này”.",
  "all-excluded": (p, f) =>
    p.count === 1
      ? `Môn ${f.str(p.course)} chỉ có một lớp, và bạn đã chọn “${f.name("exclude")}” cho lớp đó. Hãy bỏ lựa chọn đó, hoặc bỏ chọn “Xếp lịch cho môn này”.`
      : `Bạn đã chọn “${f.name("exclude")}” cho cả ${f.num(p.count)} lớp của môn ${f.str(p.course)}. Hãy bỏ lựa chọn này ở ít nhất một lớp, hoặc bỏ chọn “Xếp lịch cho môn này”.`,
  "locked-excluded": (p, f) =>
    `Lớp ${groupId(p.key, f)} của môn ${f.str(p.course)} đang được chọn cả “${f.name("lock")}” lẫn “${f.name("exclude")}”. Hãy bỏ một trong hai.`,
  "locked-missing": (p, f) =>
    `Bạn đã chọn “${f.name("lock")}” cho lớp ${groupId(p.key, f)} của môn ${f.str(p.course)}, nhưng dữ liệu đã dán không có lớp này. Hãy chọn lại lớp cho môn này.`,
  // Every group clashes with *some* locked group, not necessarily with each one.
  "conflicts-with-locked": (p, f) =>
    `Lớp nào của môn ${f.str(p.course)} cũng trùng giờ với một lớp bạn đã chọn “${f.name("lock")}”: ${f.list(p.locked, (key) => groupKey(key, f))}. Hãy bỏ lựa chọn đó, hoặc bỏ chọn “Xếp lịch cho môn này” ở môn ${f.str(p.course)}.`,
  // afterRelax is required.length > 0; the UI always sends programs as required, so it is true in practice.
  "no-combination": (p, f) =>
    p.afterRelax === true
      ? `Không có cách ghép lớp nào mà không trùng giờ, kể cả khi cho phép vi phạm các mục Bắt buộc. Hãy bỏ bớt một môn, hoặc bỏ bớt lựa chọn “${f.name("lock")}” và “${f.name("exclude")}” nếu có.`
      : `Không có cách ghép lớp nào mà không trùng giờ. Hãy bỏ bớt một môn, hoặc bỏ bớt lựa chọn “${f.name("lock")}” và “${f.name("exclude")}” nếu có.`,
  // Only emitted when nothing was found. Locking a group shrinks the search, so it is real advice.
  truncated: (_, f) =>
    `Tìm kiếm đã dừng sớm trước khi tìm thấy lịch nào, nên vẫn có thể còn lịch hợp lệ. Hãy bỏ bớt một môn, hoặc chọn “${f.name("lock")}” cho vài môn để thu hẹp tìm kiếm.`,
  // Rebuilt from params.overlap: "Thứ 2, tiết 2–3 (tuần 1–7, 9–16); Chủ nhật, tiết 8–10 (tuần 6, 10, 12, 14)".
  // Items are joined with "; " because each one already contains commas.
  "locked-overlap": (p, f) => {
    const items = Array.isArray(p.overlap) ? p.overlap : [];
    const when =
      items.length === 0
        ? f.str(undefined)
        : items
            .map((item: { day?: unknown; periods?: unknown; weeks?: unknown }) =>
              `${f.day(item?.day)}, tiết ${f.runs(item?.periods)} (tuần ${f.runs(item?.weeks)})`)
            .join("; ");
    return `Hai lớp bạn đã chọn “${f.name("lock")}” trùng giờ nhau: ${groupKey(p.a, f)} và ${groupKey(p.b, f)}, vào ${when}. Hãy bỏ lựa chọn ở một trong hai lớp.`;
  },
} satisfies Record<SolverDiagnosticCode, Message>;

/**
 * Control names that other sentences quote (see NAME_KEYS). Written once here;
 * the UI strings below and the solver messages read them through `fmt.name`.
 */
const name = {
  lock: "Chỉ học lớp này",
  exclude: "Không học lớp này",
  preferredSwitch: "Tính cả các mục “Ưu tiên”",
} satisfies Record<NameKey, string>;

/** The two end labels shared by all three sliders of block 3, so they can never differ. */
const SLIDER = { low: "Không quan trọng", high: "Quan trọng" } as const;

/**
 * Static UI strings, in the order a student meets them. Vietnamese is the
 * source of truth for the keys (`UiKey`); the English table must match it.
 *
 * Source comments: a spec reference (B2, §5 …) means the wording is taken as
 * is from `docs/ui-change-analysis.md` Part B / A4 or `docs/data-contract.md`
 * §5; a string with no reference was proposed in stage 3 and approved. The one
 * string still awaiting its final wording is marked "TẠM (PLACEHOLDER)".
 */
const ui = {
  // --- Chung -----------------------------------------------------------------
  "step.paste": "Dán dữ liệu",
  "step.courses": "Môn và lớp",
  "step.prefs": "Mong muốn", // cùng chữ với "Bạn chưa đặt mong muốn nào" (B6)
  "step.results": "Kết quả",
  "nav.back": "Quay lại",
  "nav.next": "Tiếp tục",
  "lang.switch": "Ngôn ngữ", // nhãn ARIA; hai lựa chọn "Tiếng Việt" / "English" không dịch
  // Chân trang, mọi màn hình. ĐỪNG XOÁ: ứng dụng dùng màu của trường và đọc dữ liệu đăng ký của trường;
  // thiếu dòng này, sinh viên có thể tưởng đây là công cụ chính thức và trách trường khi lịch sai.
  "footer.disclaimer": "Đồ án môn học của sinh viên. Không phải sản phẩm chính thức của trường.",

  // --- Màn hình 1: Dán dữ liệu -------------------------------------------------
  "paste.placeholder": "Dán dữ liệu từ trang Đăng ký môn học vào đây",
  // TẠM (PLACEHOLDER): chưa duyệt. Câu này phải tả đúng việc sinh viên làm trên trang
  // Đăng ký môn học, và sẽ do chủ dự án viết lại. Đừng dịch sang tiếng Anh trước khi có bản chính thức.
  // Khi sửa câu này, test "keeps the placeholder hint untranslated" (tests/i18n.test.ts) sẽ ĐỎ CÓ CHỦ Ý:
  // bản tiếng Anh ở en.ts chưa được viết. Hãy viết nó, rồi xoá test đó; đừng xoá test trước.
  "paste.hint": "Sao chép thông tin môn cùng bảng nhóm lớp trên trang Đăng ký môn học. Dán được nhiều môn cùng lúc.",
  "paste.parse": "Đọc dữ liệu", // §5 chỉ ghi "Parse"; kế hoạch ghi "Phân tích"
  "paste.warningsTitle": "Một số dòng cần xem lại",
  "paste.line": "Dòng {line}", // §5 "line N"; không dùng cho line 0 (no-courses-found là cảnh báo cho cả input)
  // Thêm khi dựng UI (2026-11-14), chữ theo docs/ui-visual-spec.md §11; chủ dự án chưa duyệt từng chữ.
  "paste.title": "Dữ liệu đăng ký",
  // Một dòng hướng dẫn cố định, luôn hiện phía trên ô dán. Chủ dự án sẽ sửa câu chữ.
  "paste.howTo":
    "Trên trang Đăng ký môn học, mở một môn rồi bôi đen từ dòng thông tin môn (mã môn, tên môn, số tín chỉ) đến hết bảng nhóm lớp của môn đó. Sao chép và dán vào ô bên dưới. Muốn xếp nhiều môn thì dán nối tiếp từng môn.",
  "paste.statusOk": (p, f) => `Đọc được ${f.num(p.n)} môn`,
  "paste.clear": "Xoá",
  "paste.sample": "Thử với dữ liệu mẫu", // điền sẵn ba môn mẫu vào ô dán, cho người chưa có gì để dán

  // --- Màn hình 2: Môn và lớp --------------------------------------------------
  "courses.credits": (p, f) => `${f.num(p.n)} TC`, // §5 (theo "? TC")
  "courses.creditsUnknown": "? TC", // §5
  "courses.totalCredits": (p, f) => `Tổng ${f.num(p.n)} tín chỉ`, // §5
  "courses.totalCreditsPartial": (p, f) => `Tổng ${f.num(p.n)} tín chỉ (chưa tính ${f.num(p.m)} môn)`, // §5, khi có môn "? TC"
  "courses.groupCount": (p, f) => `${f.num(p.n)} nhóm`, // số nhóm lớp của môn, ở hàng đầu card; truyền n là số thật (EN có số ít / số nhiều)
  "courses.colGroup": "Nhóm lớp", // cùng tên cột trong dữ liệu dán vào
  "courses.colSeats": "Đã đăng ký / Sĩ số", // dữ liệu dán vào ghi "DK/ Sĩ số"
  "courses.colProgram": "Chương trình", // chữ đầu của control "Chương trình đào tạo"
  "courses.colSessions": "Lịch", // tiêu đề cột các buổi học; EN "Class times": từ "schedule" đã dành cho thời khoá biểu
  "courses.full": "Hết chỗ", // kế hoạch ghi "Đầy"; đối với tên "Còn chỗ trống"
  "courses.periods": (p, f) => `Tiết ${f.runs(p.periods)}`,
  "courses.weeks": (p, f) => `Tuần ${f.runs(p.weeks)}`, // §5 "week runs"
  "courses.labTip": "Học cách tuần, nên có lẽ là buổi thực hành.", // đúng với cách parser đoán (detectKind)
  "courses.lock": (_, f) => f.name("lock"), // §5; chữ nằm ở `name`
  "courses.exclude": (_, f) => f.name("exclude"), // §5; chữ nằm ở `name`
  "courses.lockedChip": (p, f) => `${f.name("lock")}: ${f.str(p.group)}`, // chip ở hàng đầu card; không có chữ mới (§2.2)
  "courses.include": "Xếp lịch cho môn này", // §5 chỉ ghi "Checkbox on the card"
  "courses.warningTitle": "Lịch học cần xem lại", // tiêu đề tooltip của cảnh báo timing
  "courses.showMore": (p, f) => `Xem thêm ${f.num(p.n)} nhóm`, // link cuối bảng nhóm lớp; truyền n là số thật (EN có số ít / số nhiều)

  // --- Màn hình 3: Mong muốn ---------------------------------------------------
  // Tiêu đề ba khối (B1)
  "prefs.block.program": "Chương trình đào tạo", // B1
  "prefs.block.groups": "Lớp nào được chọn", // B1
  "prefs.block.schedule": "Bạn muốn lịch học thế nào?", // B1

  // Bộ chọn ba trạng thái (B1)
  "prefs.mode.off": "Tắt", // B1
  "prefs.mode.preferred": "Ưu tiên", // B1
  "prefs.mode.required": "Bắt buộc", // B1
  "prefs.mode.requiredTip":
    "Loại hẳn lớp vi phạm. Nếu vì thế không xếp được lịch, hệ thống sẽ nới lỏng và báo cho bạn biết.", // B1
  "prefs.mode.preferredTip": (_, f) =>
    `Vẫn có thể chọn lớp vi phạm, nhưng lịch đó bị xếp sau. Chỉ có tác dụng khi công tắc ${f.name("preferredSwitch")} đang bật.`, // B1

  // Khối 1: Chương trình (B2); không có nhãn riêng, tiêu đề khối đã là tên control
  "prefs.program.other": "Khác ({prefix})", // B2 "Khác (XYZ)"
  "prefs.program.absentTip": "Không có lớp nào thuộc chương trình này trong các môn bạn đã dán", // B2
  "prefs.program.required": "Chọn chương trình đào tạo của bạn", // B2, dòng nhắc khi nút "Xếp lịch" bị khoá

  // Khối 2: công tắc Ưu tiên (B2, B3)
  "prefs.preferredSwitch.label": (_, f) => f.name("preferredSwitch"), // B2; chữ nằm ở `name`
  "prefs.preferredSwitch.hint":
    "Khi bật, lịch vi phạm một mục đặt Ưu tiên sẽ bị xếp sau nhưng vẫn có thể được chọn.", // B2
  "prefs.preferredSwitch.disabledTip": (_, f) =>
    `Đang tắt công tắc ${f.name("preferredSwitch")}, nên mục Ưu tiên không có tác dụng. Bật lại công tắc để dùng.`, // B3
  "prefs.preferredSwitch.paused": "Đang tạm tắt (trước đó: Ưu tiên)", // B3

  // Khối 2: lưới Ngày/buổi nghỉ (B2); tên hàng Sáng / Chiều nằm ở partOff
  "prefs.partsOff.label": "Ngày/buổi nghỉ", // B2; cùng tên với nhãn ràng buộc partsOff
  "prefs.partsOff.tip": "Ngày, buổi bạn muốn nghỉ. Lớp có tiết rơi vào ô đã chọn bị tính là vi phạm.", // B2
  "prefs.partsOff.wholeDay": "Cả ngày", // B2
  // B2 "Sáng (tiết 1–6)"; dùng chung cho lưới và "Bạn thích học buổi nào?". Nhãn hàng/ô chỉ ghi "Sáng"
  // hoặc "Chiều" (cột nhãn của lưới chỉ rộng 68px); khoảng tiết nằm trong tooltip: "Sáng (tiết 1–6)".
  "prefs.periodRange": "tiết {from}–{to}",

  // Khối 2: Còn chỗ trống (B2)
  "prefs.freeSeats.label": "Còn chỗ trống", // B2; cùng tên với nhãn ràng buộc freeSeats
  "prefs.freeSeats.tip": "Chỉ chọn lớp còn chỗ. Lớp đã hết chỗ bị tính là vi phạm.", // B2

  // Khối 3: ba thanh trượt (B5); tên lựa chọn Sáng / Chiều nằm ở partStudy.
  // Hai đầu thanh trượt dùng chung một cặp chữ (quyết định 2026-11-14): chữ "Nhiều" ở thanh
  // "Đi học ít ngày" sẽ đọc thành "nhiều ngày", ngược với ý nghĩa; hỏi mức quan trọng thì không bị vậy.
  "prefs.timeOfDay.label": "Bạn thích học buổi nào?", // B5
  "prefs.timeOfDay.none": "Không", // B5
  "prefs.timeOfDay.low": SLIDER.low, // B5
  "prefs.timeOfDay.high": SLIDER.high, // B5
  "prefs.timeOfDay.tip":
    "Lịch càng có nhiều tiết ngoài buổi bạn chọn càng bị xếp sau. Tiết 13–16 luôn tính là ngoài buổi.", // B5
  "prefs.fewerDays.label": "Đi học ít ngày trong tuần", // B5
  "prefs.fewerDays.low": SLIDER.low, // B5
  "prefs.fewerDays.high": SLIDER.high, // B5
  "prefs.fewerDays.tip": "Lịch càng phải lên trường nhiều ngày trong tuần càng bị xếp sau.", // B5
  "prefs.avoidEarly.label": "Tránh tiết 1–2", // B5
  "prefs.avoidEarly.low": SLIDER.low, // B5
  "prefs.avoidEarly.high": SLIDER.high, // B5
  "prefs.avoidEarly.tip": "Lịch càng có nhiều tiết 1–2 càng bị xếp sau.", // B5

  // Tỉ trọng (B6)
  "prefs.share.label": "Tỉ trọng", // B6
  "prefs.share.value": "chiếm {p}%", // B6, cạnh công tắc Ưu tiên khi n > 0
  "prefs.share.aria": "mức {v} trên 10, chiếm {p}%", // B6, aria-valuetext
  "prefs.noWishes":
    "Bạn chưa đặt mong muốn nào. Các phương án hợp lệ sẽ được liệt kê theo thứ tự tìm thấy, không theo mức độ phù hợp.", // B6

  // Cuối màn hình (B7)
  "prefs.topK": "Hiển thị {n} phương án", // B7; UI đặt stepper vào chỗ {n}
  "prefs.solve": "Xếp lịch", // B7

  // --- Màn hình 4: Kết quả -----------------------------------------------------
  "results.relaxedTitle": "Không có lịch nào đáp ứng đủ các mục Bắt buộc",
  "results.infeasibleTitle": "Không xếp được lịch nào",
  // Nói về dữ liệu, không nói lý do: môn có thể có lớp của chương trình nhưng sinh viên đã loại hết ở bước 2 (A4).
  "results.noProgram": "Môn {course} không còn lớp nào thuộc chương trình {program}.", // A4
  "results.noProgramWhy": "Môn này chỉ còn lớp của chương trình {available}.", // A4 "có thể nêu available"
  "results.dropCourse": "Bỏ môn này và xếp lại",
  "results.option": "Phương án {n}", // §5
  "results.tie": "Ngang nhau", // §5
  "results.violation": (p, f) => `${f.constraint(p.item)}: ${f.list(p.courses)}`, // §5 "Ngày/buổi nghỉ: CO2007"
  "results.periodRow": "Tiết {n}",
  "results.alternating": "Xen kẽ tuần", // §5
  "results.registerList": "Các lớp cần đăng ký", // §5 "the list of groups to register for"
  // Phương án thay thế là "hoặc", nên nối bằng dấu phẩy, không dùng "và" của Intl.ListFormat.
  "results.alternatives": (p, f) =>
    `Cũng được: ${Array.isArray(p.list) && p.list.length > 0 ? p.list.map(f.str).join(", ") : f.str(undefined)}`, // §5 "Also works"
  "results.truncated": "Tìm kiếm đã dừng sớm, có thể còn phương án tốt hơn", // B7
  "results.stats": (p, f) =>
    typeof p.ms === "number" && p.ms < 1000
      ? "Tìm trong chưa đầy 1 giây"
      : `Tìm trong ${f.num(typeof p.ms === "number" ? Math.round(p.ms / 100) / 10 : undefined)} giây`,
  "results.empty": "Bạn chưa chọn môn nào để xếp lịch.",
  "results.solving": "Đang xếp lịch…",
  // Thêm khi dựng UI (2026-11-14), chữ theo docs/ui-visual-spec.md §11; chủ dự án chưa duyệt từng chữ.
  "results.relaxedDetails": "Chi tiết",
  "results.rankHint": "Xếp từ phù hợp nhất →",
  "results.bestBadge": "Phù hợp nhất",
  "results.weekAll": "Tất cả",
  "results.weekByWeek": "Theo tuần",
  "results.weekPrev": "Tuần trước", // nhãn truy cập của nút ‹
  "results.weekNext": "Tuần sau", // nhãn truy cập của nút ›
  "results.legendViolation": "Vi phạm",
  "results.gridPeriod": "Tiết", // tiêu đề cột số tiết
  // Worker không chạy được hoặc gặp lỗi (không phải kết quả của solve: solve không bao giờ ném lỗi).
  "results.workerError": "Bộ xếp lịch gặp lỗi và không chạy được. Hãy thử lại.",
  "results.retry": "Thử lại",
  // Mọi phương án tìm được đều lấy lớp của chương trình khác, nên không phương án nào được hiển thị (A4 mở rộng).
  "results.outsideProgram":
    "Không có lịch nào chỉ gồm các lớp thuộc chương trình đào tạo của bạn mà vẫn đáp ứng các lựa chọn còn lại. Lịch phải lấy lớp của chương trình khác thì bạn không đăng ký được, nên không được hiển thị.",
} satisfies Record<string, Message>;

/** Every static UI key; `ui(key)` only accepts these. */
export type UiKey = keyof typeof ui;

/** Vietnamese (primary language). Sections are filled stage by stage; see status.ts. */
export const vi: Dictionary = {
  parse,
  timing,
  solver,
  constraint,
  dayLong,
  dayShort,
  partOff,
  partStudy,
  campus,
  kind,
  name,
  ui,
};
