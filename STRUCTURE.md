# Cấu trúc dự án — ứng dụng xếp thời khoá biểu HCMUT (bản dựng lại)

Repo này dựng lại từ đầu ứng dụng xếp thời khoá biểu HCMUT, theo đúng thứ tự bản gốc đã được xây. File này là **bản đồ đích**: mỗi thư mục, mỗi file sẽ xuất hiện ở buổi nào và để làm gì. Nhãn `[B1]`…`[B8]` là số buổi.

## Ứng dụng làm gì

Sinh viên dán các khối môn học copy từ trang **Đăng ký môn học**, chọn yêu cầu (cơ sở, ngày nghỉ, ngôn ngữ, còn chỗ…), và nhận 5 thời khoá biểu không trùng giờ tốt nhất. Sau đó có thể khoá nhóm, xử lý nhóm đã đầy, đăng ký theo danh sách, xuất `.ics` / PNG / in.

Ứng dụng chạy hoàn toàn trên trình duyệt: không backend, không tài khoản. Dữ liệu chỉ nằm trong `localStorage` của người dùng.

## Luồng dữ liệu

```
văn bản dán ─ parse() ─► Course[] + cảnh báo              src/lib/parser/
            ─ buildMasks() ─► nhóm kèm mặt nạ bit 3360 ô   src/lib/timing/
            ─ solve(courses, prefs) ─► top-5 lịch          src/lib/solver/  (chạy trong Web Worker)
            ─ reducer ─► giao diện, xuất tệp               src/app/, src/components/, src/lib/view/, src/lib/export/
```

## Quy tắc phân tầng

`src/lib/**` là code thuần: không import React, không dùng `window`, `document`, `localStorage`. Vì vậy mọi phần quan trọng đều test được trong Node. Các tầng chỉ phụ thuộc xuống dưới:

```
parser  ←  timing  ←  solver  ←  view  ←  export      (src/lib, thuần)
                                   ↑
                         src/app   (trạng thái, Worker, localStorage)
                                   ↑
                         src/components  ←  src/App.tsx  ←  src/main.tsx
```

## Cây thư mục đích

```
tkb_hoclai/
├── index.html                  [B1]       trang gốc, nạp src/main.tsx
├── package.json                [B1]       lệnh dev / build / test / lint; lúc chạy chỉ cần react, react-dom
├── package-lock.json           [B1]       do npm sinh ra
├── tsconfig.json               [B1]       gom ba cấu hình bên dưới
├── tsconfig.app.json           [B1]       code trong src/ (có DOM)
├── tsconfig.node.json          [B1]       vite.config.ts (chạy trong Node)
├── tsconfig.test.json          [B1]       code trong tests/
├── vite.config.ts              [B1 → B8]  plugin React + Tailwind, Worker ES module, cấu hình Vitest
├── .oxlintrc.json              [B1]       luật lint
├── .gitignore                  [B1]       bỏ qua node_modules, dist…
├── README.md                   [B8]       hướng dẫn người dùng
├── .github/workflows/ci.yml    [B8]       CI: test + lint + tsc trên mỗi push
├── public/favicon.svg          [B8]       biểu tượng trang
│
├── src/
│   ├── main.tsx                [B1]       gắn <App /> vào #root
│   ├── App.tsx                 [B1 tạm → B7–B8]  ghép 5 bước
│   ├── index.css               [B1 tạm → B7]     Tailwind + màu Catppuccin Mocha (ctp-*)
│   │
│   ├── lib/                               thư viện thuần
│   │   ├── parser/             [B2]       văn bản → môn / nhóm / buổi học
│   │   │     types.ts  parse.ts  program.ts  index.ts  README.md
│   │   ├── timing/             [B3]       mặt nạ bit thời gian, kiểm tra trùng giờ
│   │   │     constants.ts  mask.ts  build.ts  conflicts.ts  index.ts  README.md
│   │   ├── solver/                        tìm top-K lịch
│   │   │     [B4] types.ts  constants.ts  filter.ts  score.ts
│   │   │     [B5] equivalence.ts  search.ts  solve.ts  index.ts  README.md
│   │   │     [B6] protocol.ts  worker.ts
│   │   ├── view/               [B7]       dữ liệu để hiển thị
│   │   │     format.ts  grid.ts  summary.ts  checklist.ts  palette.ts
│   │   └── export/             [B8]       .ics, bố cục PNG, giờ các tiết
│   │         periods.ts  ics.ts  image.ts
│   │
│   ├── app/                               trạng thái, lưu trữ, Worker
│   │     [B6] pastes.ts  selection.ts  state.ts  storage.ts  useSolver.ts
│   │     [B7] messages.ts
│   │     [B8] browser.ts  imageExport.ts
│   │
│   └── components/                        giao diện React, không chứa logic nghiệp vụ
│         [B7] ui.tsx  courseColor.ts  Stepper.tsx  PasteInput.tsx  CoursePreview.tsx
│              PreferencesForm.tsx  SelectionsCard.tsx  StatusBanner.tsx  ResultTabs.tsx
│              PickList.tsx  ScoreBreakdown.tsx  TimetableSection.tsx  TimetableGrid.tsx
│              DayList.tsx  WeekSelector.tsx  Checklist.tsx
│         [B8] ExportPanel.tsx
│
└── tests/
      [B2] fixtures/  (CO2001, CO2003, CO2007, CO2011, SK2001, SP1031 — dữ liệu thật, không tự gõ)
      [B2] fixtureText.ts  parser.test.ts
      [B3] timing.test.ts
      [B5] solver.test.ts
      [B6] protocol.test.ts  storage.test.ts  perf.test.ts
      [B7] format.test.ts  grid.test.ts  summary.test.ts  messages.test.ts
           state.test.ts  shortterm.test.ts  contrast.test.ts
      [B8] ics.test.ts  image.test.ts  app.smoke.test.tsx
```

## Các buổi

| Buổi | Chủ đề | Câu hỏi mà buổi đó trả lời |
|---|---|---|
| B1 | Khởi tạo | Vì sao chỉ chạy phía client? Vì sao tách ba tsconfig? |
| B2 | Parser | Đọc văn bản trang đăng ký thế nào? Vì sao trả cảnh báo thay vì ném lỗi? |
| B3 | Bitmask | Vì sao 3360 bit? Vì sao trùng giờ chỉ là phép AND? |
| B4 | Solver 1 | Ràng buộc cứng và mềm khác nhau thế nào? Một lịch được chấm điểm ra sao? |
| B5 | Solver 2 | MRV, quay lui, forward checking, nới yêu cầu |
| B6 | Worker + state | Vì sao cần luồng nền? Vì sao trạng thái nằm trong reducer? |
| B7 | Giao diện | 5 bước trên màn hình; vì sao component không chứa logic |
| B8 | Export + CI | `.ics`, PNG, CI, chạy toàn bộ cổng kiểm tra |
