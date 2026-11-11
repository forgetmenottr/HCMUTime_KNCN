import type { Day } from "../lib/parser";
import type { ConstraintName } from "../lib/solver";
import type { Dictionary, HalfDay, Message, NameKey } from "./types";

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
 * Control names that other sentences quote (see NAME_KEYS). Written once here;
 * the UI strings below and the solver messages read them through `fmt.name`.
 */
const name = {
  lock: "Chỉ học lớp này",
  exclude: "Không học lớp này",
  preferredSwitch: "Tính cả các mục “Ưu tiên”",
} satisfies Record<NameKey, string>;

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

  // --- Màn hình 1: Dán dữ liệu -------------------------------------------------
  "paste.placeholder": "Dán dữ liệu từ trang Đăng ký môn học vào đây",
  // TẠM (PLACEHOLDER): chưa duyệt. Câu này phải tả đúng việc sinh viên làm trên trang
  // Đăng ký môn học, và sẽ do chủ dự án viết lại. Đừng dịch sang tiếng Anh trước khi có bản chính thức.
  "paste.hint": "Sao chép thông tin môn cùng bảng nhóm lớp trên trang Đăng ký môn học. Dán được nhiều môn cùng lúc.",
  "paste.parse": "Đọc dữ liệu", // §5 chỉ ghi "Parse"; kế hoạch ghi "Phân tích"
  "paste.warningsTitle": "Một số dòng cần xem lại",
  "paste.line": "Dòng {line}", // §5 "line N"; không dùng cho line 0 (no-courses-found là cảnh báo cho cả input)

  // --- Màn hình 2: Môn và lớp --------------------------------------------------
  "courses.credits": (p, f) => `${f.num(p.n)} TC`, // §5 (theo "? TC")
  "courses.creditsUnknown": "? TC", // §5
  "courses.totalCredits": (p, f) => `Tổng ${f.num(p.n)} tín chỉ`, // §5
  "courses.totalCreditsPartial": (p, f) => `Tổng ${f.num(p.n)} tín chỉ (chưa tính ${f.num(p.m)} môn)`, // §5, khi có môn "? TC"
  "courses.colGroup": "Nhóm lớp", // cùng tên cột trong dữ liệu dán vào
  "courses.colSeats": "Đã đăng ký / Sĩ số", // dữ liệu dán vào ghi "DK/ Sĩ số"
  "courses.colProgram": "Chương trình", // chữ đầu của control "Chương trình đào tạo"
  "courses.full": "Hết chỗ", // kế hoạch ghi "Đầy"; đối với tên "Còn chỗ trống"
  "courses.periods": (p, f) => `Tiết ${f.runs(p.periods)}`,
  "courses.weeks": (p, f) => `Tuần ${f.runs(p.weeks)}`, // §5 "week runs"
  "courses.labTip": "Học cách tuần, nên có lẽ là buổi thực hành.", // đúng với cách parser đoán (detectKind)
  "courses.lock": (_, f) => f.name("lock"), // §5; chữ nằm ở `name`
  "courses.exclude": (_, f) => f.name("exclude"), // §5; chữ nằm ở `name`
  "courses.include": "Xếp lịch cho môn này", // §5 chỉ ghi "Checkbox on the card"
  "courses.warningTitle": "Lịch học cần xem lại", // tiêu đề tooltip của cảnh báo timing

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
  "prefs.periodRange": "tiết {from}–{to}", // B2 "Sáng (tiết 1–6)"; dùng chung cho lưới và "Bạn thích học buổi nào?"

  // Khối 2: Còn chỗ trống (B2)
  "prefs.freeSeats.label": "Còn chỗ trống", // B2; cùng tên với nhãn ràng buộc freeSeats
  "prefs.freeSeats.tip": "Chỉ chọn lớp còn chỗ. Lớp đã hết chỗ bị tính là vi phạm.", // B2

  // Khối 3: ba thanh trượt (B5); tên lựa chọn Sáng / Chiều nằm ở partStudy
  "prefs.timeOfDay.label": "Bạn thích học buổi nào?", // B5
  "prefs.timeOfDay.none": "Không", // B5
  "prefs.timeOfDay.low": "Không quan trọng", // B5
  "prefs.timeOfDay.high": "Rất muốn", // B5
  "prefs.timeOfDay.tip":
    "Lịch càng có nhiều tiết ngoài buổi bạn chọn càng bị xếp sau. Tiết 13–16 luôn tính là ngoài buổi.", // B5
  "prefs.fewerDays.label": "Đi học ít ngày trong tuần", // B5
  "prefs.fewerDays.low": "Không quan trọng", // B5
  "prefs.fewerDays.high": "Càng ít ngày càng tốt", // B5
  "prefs.fewerDays.tip": "Lịch càng phải lên trường nhiều ngày trong tuần càng bị xếp sau.", // B5
  "prefs.avoidEarly.label": "Tránh tiết 1–2", // B5
  "prefs.avoidEarly.low": "Không quan trọng", // B5
  "prefs.avoidEarly.high": "Tránh hẳn", // B5
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
} satisfies Record<string, Message>;

/** Every static UI key; `ui(key)` only accepts these. */
export type UiKey = keyof typeof ui;

/** Vietnamese (primary language). Sections are filled stage by stage; see status.ts. */
export const vi: Dictionary = {
  parse: {},
  timing: {},
  solver: {},
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
