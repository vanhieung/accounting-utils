// -*- coding: utf-8 -*-
/**
 * INVOICE → MISA TEMPLATE MATCHER (Node.js version)
 * 
 * Mục tiêu:
 *   Đọc hóa đơn XML, phân tích dữ liệu,
 *   xác định hóa đơn có thể import vào template nào trong assets/ (buying/ hoặc selling/),
 *   và tự động điền dữ liệu vào template tương ứng.
 */

const fs = require('fs');
const path = require('path');
const { XMLParser } = require('fast-xml-parser');
const xlsx = require('xlsx');

// Keywords and Classification Criteria — Sets for O(1) lookup instead of Array.some()
const SERVICE_KEYWORDS = [
    "dịch vụ", "phí", "bản quyền", "thuê", "bảo trì", "bảo hành",
    "tư vấn", "vận chuyển", "cước", "quảng cáo", "hosting", "domain",
    "phần mềm", "license", "subscription", "service", "lắp đặt",
    "sửa chữa", "gia công", "thiết kế", "đào tạo", "bảo hiểm",
    "internet", "điện thoại"
];

const GOODS_DVT_SET = new Set([
    "cái", "chiếc", "hộp", "thùng", "lốc", "kg", "tấn", "m", "m2",
    "bộ", "cuộn", "chai", "lon", "gói", "túi", "bao", "quyển", "tờ",
    "lít", "can", "bình", "hũ", "thanh", "tấm", "miếng", "viên",
    "đôi", "cây", "quả", "trái", "bịch", "tuýp", "ống"
]);

const SERVICE_DVT_SET = new Set(["bản", "gói", "lần", "tháng", "năm"]);

const CONSUMABLE_KEYWORDS = [
    "bánh", "nước", "sữa", "cà phê", "trà", "đường", "muối",
    "xà phòng", "giấy", "bút", "mực", "văn phòng phẩm",
    "pin", "cáp", "sạc", "phụ kiện", "đồ dùng",
    "thực phẩm", "đồ uống", "snack", "kẹo"
];

const STOCKABLE_KEYWORDS = [
    "nguyên vật liệu", "nguyên liệu", "vật tư", "linh kiện",
    "máy", "thiết bị", "điện thoại", "laptop", "máy tính",
    "hàng hóa", "sản phẩm", "thành phẩm"
];

// Helper functions
function formatDate(dateStr) {
    if (!dateStr) return "";
    const parts = dateStr.split("-");
    if (parts.length === 3) {
        return `${parts[2]}/${parts[1]}/${parts[0]}`;
    }
    return dateStr;
}

function parseTaxRate(taxStr) {
    if (!taxStr) return null;
    const cleanStr = taxStr.replace("%", "").trim();
    const upper = cleanStr.toUpperCase();
    if (upper === "KCT" || upper === "KKKNT" || cleanStr === "0") {
        return 0;
    }
    const val = parseFloat(cleanStr);
    if (!isNaN(val)) {
        return val / 100;
    }
    return taxStr;
}

function parseSafeNumber(val) {
    if (val === null || val === undefined) return null;
    const clean = String(val).trim();
    if (clean === "") return null;
    const num = Number(clean);
    return isNaN(num) ? clean : num;
}

// XML parser configuration
const parser = new XMLParser({
    ignoreAttributes: false,
    parseTagValue: false, // keep tag values as string to prevent auto-truncating lead zeros in code fields
});

function parseInvoiceXML(xmlPath) {
    const xmlContent = fs.readFileSync(xmlPath, 'utf8');
    const jsonObj = parser.parse(xmlContent);

    const hdon = jsonObj.HDon;
    if (!hdon) return null;

    const dlHDon = hdon.DLHDon;
    if (!dlHDon) return null;

    const ttChung = dlHDon.TTChung;
    const ndHDon = dlHDon.NDHDon;
    if (!ttChung || !ndHDon) return null;

    const invoice = {
        file: path.basename(xmlPath),
        kh_ms_hdon: ttChung.KHMSHDon,
        kh_hdon: ttChung.KHHDon,
        so_hdon: ttChung.SHDon,
        ngay_lap: ttChung.NLap,
        dvt_te: ttChung.DVTTe,
        httt: ttChung.HTTToan,
    };

    // Check replacement or adjustment
    const lq = ttChung.TTHDLQuan;
    if (lq && lq.TCHDon) {
        invoice.loai_lien_quan = lq.TCHDon === "1" ? "thay_the" : lq.TCHDon === "2" ? "dieu_chinh" : lq.TCHDon;
        invoice.ghi_chu_lq = lq.GChu;
    }

    // NBan
    const nban = ndHDon.NBan;
    if (nban) {
        invoice.nban_ten = nban.Ten;
        invoice.nban_mst = nban.MST;
        invoice.nban_dchi = nban.DChi;
    }

    // NMua
    const nmua = ndHDon.NMua;
    if (nmua) {
        invoice.nmua_ten = nmua.Ten;
        invoice.nmua_mst = nmua.MST;
        invoice.nmua_dchi = nmua.DChi;
    }

    // Hàng hóa / dịch vụ
    let items = [];
    const ds = ndHDon.DSHHDVu;
    if (ds && ds.HHDVu) {
        let rawItems = ds.HHDVu;
        if (!Array.isArray(rawItems)) {
            rawItems = [rawItems];
        }
        items = rawItems.map(item => {
            const thTien = parseSafeNumber(item.ThTien) || 0;
            const tSuat = item.TSuat || "";
            let tienThue = 0;
            const rate = parseTaxRate(tSuat);
            if (rate !== null && typeof rate === "number") {
                tienThue = Math.round(thTien * rate);
            }
            return {
                tchat: item.TChat !== undefined ? String(item.TChat).trim() : "",
                ma: item.MHHDVu || "",
                ten: item.THHDVu || "",
                dvt: item.DVTinh || "",
                so_luong: parseSafeNumber(item.SLuong),
                don_gia: parseSafeNumber(item.DGia),
                thanh_tien: thTien,
                thue_suat: tSuat,
                tien_thue: tienThue
            };
        });
    }
    invoice.items = items;

    // TToan
    const ttoan = ndHDon.TToan;
    if (ttoan) {
        invoice.tong_chua_thue = parseSafeNumber(ttoan.TgTCThue);
        invoice.tong_thue = parseSafeNumber(ttoan.TgTThue);
        invoice.tong_thanh_toan = parseSafeNumber(ttoan.TgTTTBSo);
    }

    return invoice;
}

// Classifier Engine
function classifyInvoice(invoice, type = 'buying') {
    const items = invoice.items || [];

    // Analyze item keywords & TChat tags
    let serviceScore = 0;
    let goodsScore = 0;
    let consumableScore = 0;
    let stockableScore = 0;

    items.forEach(item => {
        const name = (item.ten || "").toLowerCase();
        const dvt = (item.dvt || "").toLowerCase();
        const tchat = String(item.tchat || "").trim();

        if (tchat === "2") {
            serviceScore += 3;
        } else if (tchat === "1") {
            goodsScore += 2;
        }

        if (SERVICE_KEYWORDS.some(kw => name.includes(kw))) {
            serviceScore += 2;
        }

        if (GOODS_DVT_SET.has(dvt)) {
            goodsScore += 2;
        } else if (SERVICE_DVT_SET.has(dvt)) {
            serviceScore += 1;
        } else if (dvt) {
            goodsScore += 1;
        }

        if (CONSUMABLE_KEYWORDS.some(kw => name.includes(kw))) {
            consumableScore += 1;
        }

        if (STOCKABLE_KEYWORDS.some(kw => name.includes(kw))) {
            stockableScore += 1;
        }
    });

    const isService = serviceScore > goodsScore;
    const isPhysicalGoods = goodsScore >= serviceScore && goodsScore > 0;
    const isConsumable = consumableScore > 0;
    const isStockable = stockableScore > 0;

    const hasInvoiceNumber = invoice.so_hdon !== undefined && invoice.so_hdon !== null;
    const allPositiveAmounts = items.every(item => (item.thanh_tien || 0) >= 0);

    const templates = type === 'selling' ? [
        {
            file: "Ban_hang.xls",
            name: "Bán hàng",
            exclude: isService,
            score: isPhysicalGoods ? 95 : 50,
            reasons: [
                isPhysicalGoods ? "✅ Nội dung là hàng hóa vật lý" : "⚠ Ít phù hợp cho dịch vụ",
            ]
        },
        {
            file: "Hoa_don_ban_hang.xls",
            name: "Hóa đơn bán hàng",
            exclude: false,
            score: isService ? 95 : 70,
            reasons: [
                isService ? "✅ Nội dung là dịch vụ/bản quyền/phí" : "⚠ Thường dùng cho dịch vụ hoặc bán hàng không kiêm xuất kho",
            ]
        },
        {
            file: "Bao_gia.xls",
            name: "Báo giá",
            exclude: hasInvoiceNumber,
            score: 0,
            reasons: ["❌ Loại trừ: Đã phát hành số hóa đơn → không phải báo giá dự kiến"]
        },
        {
            file: "Don_dat_hang.xls",
            name: "Đơn đặt hàng",
            exclude: hasInvoiceNumber,
            score: 0,
            reasons: ["❌ Loại trừ: Đã phát hành số hóa đơn → không phải đơn đặt hàng dự kiến"]
        },
        {
            file: "Doanh_thu_nhan_truoc.xls",
            name: "Doanh thu nhận trước",
            exclude: true,
            score: 0,
            reasons: ["❌ Loại trừ: File XML là hóa đơn điện tử, cần xác nhận thủ công nếu là doanh thu nhận trước"]
        },
        {
            file: "Doanh_thu_nhan_truoc_dau_ky.xls",
            name: "Doanh thu nhận trước đầu kỳ",
            exclude: true,
            score: 0,
            reasons: ["❌ Loại trừ: File XML là hóa đơn điện tử, cần xác nhận thủ công nếu là doanh thu nhận trước đầu kỳ"]
        },
        {
            file: "Hang_ban_giam_gia.xls",
            name: "Hàng bán giảm giá",
            exclude: allPositiveAmounts,
            score: 0,
            reasons: ["❌ Loại trừ: Tất cả đơn giá/số tiền đều dương → không phải chứng từ giảm giá"]
        },
        {
            file: "Hang_ban_tra_lai.xls",
            name: "Hàng bán trả lại",
            exclude: allPositiveAmounts,
            score: 0,
            reasons: ["❌ Loại trừ: Không có số tiền âm hoặc giảm trừ để trả lại hàng"]
        }
    ] : [
        {
            file: "Mua_hang_khong_qua_kho.xls",
            name: "Mua hàng không qua kho",
            exclude: false,
            score: isPhysicalGoods ? (isConsumable ? 100 : 70) : (isService ? 10 : 50),
            reasons: [
                isPhysicalGoods ? "✅ Nội dung là hàng hóa vật lý" : "⚠ Ít phù hợp cho dịch vụ",
                isConsumable ? "✅ Hàng tiêu dùng/dùng ngay → cực kỳ phù hợp không qua kho" : "⚠ Không rõ tính tiêu dùng",
            ]
        },
        {
            file: "Mua_hang_qua_kho.xls",
            name: "Mua hàng qua kho (nhập kho)",
            exclude: false,
            score: isPhysicalGoods ? (isStockable ? 80 : 65) : 10,
            reasons: [
                isPhysicalGoods ? "✅ Nội dung là hàng hóa vật lý" : "⚠ Hàng hóa qua kho phải là vật lý",
                isStockable ? "✅ Hàng tồn kho được → phù hợp nhập kho" : "⚠ Hàng tiêu hao dùng ngay → ít khi qua kho",
            ]
        },
        {
            file: "Mua_dich_vu.xls",
            name: "Mua dịch vụ",
            exclude: isPhysicalGoods && !isService,
            score: isService ? 95 : 10,
            reasons: [
                isService ? "✅ Nội dung là dịch vụ/bản quyền/phí" : "❌ Loại trừ: nội dung là hàng hóa vật lý, không phải mua dịch vụ",
            ]
        },
        {
            file: "Don_mua_hang.xls",
            name: "Đơn mua hàng",
            exclude: hasInvoiceNumber,
            score: 0,
            reasons: ["❌ Loại trừ: Đã phát hành số hóa đơn → không phải đơn mua hàng dự kiến"]
        },
        {
            file: "Mau_Hop_dong_mua.xls",
            name: "Hợp đồng mua",
            exclude: true,
            score: 0,
            reasons: ["❌ Loại trừ: File XML là hóa đơn điện tử, không phải hợp đồng kinh tế"]
        },
        {
            file: "Hang_mua_giam_gia.xls",
            name: "Hàng mua giảm giá",
            exclude: allPositiveAmounts,
            score: 0,
            reasons: ["❌ Loại trừ: Tất cả đơn giá/số tiền đều dương → không phải chứng từ giảm giá"]
        },
        {
            file: "Tra_lai_hang_mua_khong_qua_kho.xls",
            name: "Trả lại hàng mua - không qua kho",
            exclude: allPositiveAmounts,
            score: 0,
            reasons: ["❌ Loại trừ: Không có số tiền âm hoặc giảm trừ để trả lại hàng"]
        },
        {
            file: "Tra_lai_hang_mua_qua_kho.xls",
            name: "Trả lại hàng mua - qua kho",
            exclude: allPositiveAmounts,
            score: 0,
            reasons: ["❌ Loại trừ: Không có số tiền âm hoặc giảm trừ để trả lại hàng"]
        },
        {
            file: "Mua_hang_nhieu_hoa_don_khong_qua_kho.xls",
            name: "Mua hàng nhiều HĐ - không qua kho",
            exclude: true,
            score: 0,
            reasons: ["❌ Loại trừ: File XML đơn lẻ → không cần template nhiều hóa đơn"]
        },
        {
            file: "Mua_hang_nhieu_hoa_don_qua_kho.xls",
            name: "Mua hàng nhiều HĐ - qua kho",
            exclude: true,
            score: 0,
            reasons: ["❌ Loại trừ: File XML đơn lẻ → không cần template nhiều hóa đơn"]
        }
    ];

    const results = templates
        .map(t => {
            if (t.exclude) t.score = 0;
            return t;
        })
        .sort((a, b) => b.score - a.score);

    return results;
}

// Mapper for header mapping
const valueMapper = {
    "Hiển thị trên sổ": (invoice, item) => 2,
    "Nhận kèm hóa đơn": (invoice, item) => 1,
    "Ngày hạch toán (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày hạch toán": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày chứng từ (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày chứng từ": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày đơn hàng (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày ký (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Mẫu số HĐ": (invoice, item) => invoice.kh_ms_hdon,
    "Ký hiệu HĐ": (invoice, item) => invoice.kh_hdon,
    "Số hóa đơn": (invoice, item) => invoice.so_hdon,
    "Ngày hóa đơn": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày hóa đơn (*)": (invoice, item) => formatDate(invoice.ngay_lap),

    // Voucher numbers / So chung tu
    "Số chứng từ (*)": (invoice, item) => invoice.so_hdon,
    "Số chứng từ": (invoice, item) => invoice.so_hdon,
    "Số phiếu nhập (*)": (invoice, item) => invoice.so_hdon,
    "Số phiếu nhập": (invoice, item) => invoice.so_hdon,
    "Số đơn hàng (*)": (invoice, item) => invoice.so_hdon,
    "Số đơn hàng": (invoice, item) => invoice.so_hdon,
    "Số hợp đồng (*)": (invoice, item) => invoice.so_hdon,
    "Số hợp đồng": (invoice, item) => invoice.so_hdon,
    "Số báo giá (*)": (invoice, item) => invoice.so_hdon,
    "Số báo giá": (invoice, item) => invoice.so_hdon,
    "STT Hóa đơn (*)": (invoice, item) => 1,
    "Số phiếu xuất": (invoice, item) => invoice.so_hdon,
    "Số phiếu thu": (invoice, item) => invoice.so_hdon,
    "Số chứng từ thanh toán": (invoice, item) => invoice.so_hdon,

    // Partner reference
    "Mã nhà cung cấp": (invoice, item) => invoice.nban_mst,
    "Mã nhà cung cấp (*)": (invoice, item) => invoice.nban_mst,
    "Mã NCC": (invoice, item) => invoice.nban_mst,
    "Tên nhà cung cấp": (invoice, item) => invoice.nban_ten,
    "Tên NCC": (invoice, item) => invoice.nban_ten,
    "Mã số thuế NCC": (invoice, item) => invoice.nban_mst,
    "Địa chỉ NCC": (invoice, item) => invoice.nban_dchi,
    "Mã khách hàng": (invoice, item) => invoice.nmua_mst,
    "Mã khách hàng (*)": (invoice, item) => invoice.nmua_mst,
    "Tên khách hàng": (invoice, item) => invoice.nmua_ten,
    "Mã số thuế": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,
    "Địa chỉ khách hàng": (invoice, item) => invoice.nmua_dchi,
    "Đối tượng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,
    "Mã đối tượng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,
    "Người mua hàng": (invoice, item) => invoice.nmua_ten,
    "Người giao hàng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_ten : invoice.nban_ten,
    "Người liên hệ": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_ten : invoice.nban_ten,

    // Accounts Defaults
    "TK chi phí (*)": (invoice, item) => "6422",
    "TK kho (*)": (invoice, item) => "1561",
    "TK kho": (invoice, item) => "1561",
    "TK Kho": (invoice, item) => "1561",
    "TK chi phí/TK kho (*)": (invoice, item) => "6422",
    "TK kho/TK chi phí (*)": (invoice, item) => "1561",
    "TK công nợ/TK tiền (*)": (invoice, item) => invoice.type === 'selling' ? "131" : "331",
    "TK công nợ/TK tiền/TK có (*)": (invoice, item) => invoice.type === 'selling' ? "131" : "331",
    "TK Tiền/Chi phí/Nợ (*)": (invoice, item) => "131",
    "TK Doanh thu/Có (*)": (invoice, item) => {
        const isService = invoice.items && invoice.items.some(it => {
            const name = (it.ten || "").toLowerCase();
            return SERVICE_KEYWORDS.some(kw => name.includes(kw));
        });
        return isService ? "5113" : "5111";
    },
    "TK giảm giá/TK nợ (*)": (invoice, item) => "5211",
    "TK giảm giá/TK nợ": (invoice, item) => "5211",
    "TK trả lại/TK nợ (*)": (invoice, item) => "5212",
    "TK trả lại/TK nợ": (invoice, item) => "5212",
    "TK chiết khấu": (invoice, item) => "5211",
    "TK giá vốn": (invoice, item) => "632",
    "TK thuế GTGT": (invoice, item) => invoice.type === 'selling' ? "33311" : "1331",
    "TKĐƯ thuế GTGT": (invoice, item) => invoice.type === 'selling' ? "131" : "331",

    // Warehouse mappings
    "Mã kho": (invoice, item) => "156",
    "Kho": (invoice, item) => "156",
    "Cách lấy đơn giá nhập": (invoice, item) => 1,
    "Kèm theo chứng từ gốc (Phiếu nhập)": (invoice, item) => 0,
    "Hàng hoá giữ hộ/bán hộ": (invoice, item) => 0,
    "Hàng hóa giữ hộ/bán hộ": (invoice, item) => 0,

    // Unearned revenue details
    "Mã DT nhận trước (*)": (invoice, item) => item.ma || `DTNT_${invoice.so_hdon}`,
    "Tên DT nhận trước (*)": (invoice, item) => item.ten || `DT nhận trước cho HĐ ${invoice.so_hdon}`,
    "Ngày ghi nhận (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày bắt đầu phân bổ (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Số tiền (*)": (invoice, item) => item.thanh_tien,
    "Số kỳ phân bổ (*)": (invoice, item) => 12,
    "Số tiền PB hàng kỳ (*)": (invoice, item) => Math.round((item.thanh_tien || 0) / 12),
    "Số kỳ đã phân bổ (*)": (invoice, item) => 0,
    "Số tiền đã phân bổ (*)": (invoice, item) => 0,
    "TK DT chưa thực hiện (*)": (invoice, item) => "3387",
    "PB chi tiết theo đối tượng": (invoice, item) => 0,
    "TK phân bổ doanh thu": (invoice, item) => "5111",
    "Đối tượng phân bổ": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,
    "Tỷ lệ phân bổ": (invoice, item) => 100,
    "TK phân bổ DT theo đối tượng": (invoice, item) => "5111",

    // General transaction types & Statuses
    "Hình thức mua hàng": (invoice, item) => 1,
    "Hình thức bán hàng": (invoice, item) => {
        if (invoice.template === "Hoa_don_ban_hang.xls") {
            return 1; // Bán hàng hóa, dịch vụ trong nước
        }
        return 2; // Bán lẻ trong nước
    },
    "Phương thức thanh toán": (invoice, item) => {
        if (invoice.type === 'selling') {
            return 0; // Chưa thu tiền
        }
        const httt = (invoice.httt || "").toUpperCase();
        if (httt === "TM") return 1; // Tiền mặt
        if (httt === "CK") return 2; // Ủy nhiệm chi
        return 0; // Chưa thanh toán
    },
    "Kiêm phiếu xuất kho": (invoice, item) => {
        const isService = invoice.items && invoice.items.some(it => {
            const name = (it.ten || "").toLowerCase();
            return SERVICE_KEYWORDS.some(kw => name.includes(kw));
        });
        return isService ? 0 : 1;
    },
    "Kiêm phiếu nhập kho": (invoice, item) => 1,
    "Lập kèm hóa đơn": (invoice, item) => 1,
    "Đã lập hóa đơn": (invoice, item) => 1,
    "Đã hạch toán": (invoice, item) => 1,
    "Tình trạng": (invoice, item) => 1,
    "Tính giá thành": (invoice, item) => 0,

    // Flags / Placeholders
    "Là CP mua hàng": (invoice, item) => 0,
    "Hàng khuyến mại": (invoice, item) => 0,
    "Là dòng chiết khấu thương mại": (invoice, item) => 0,
    "XK vào khu phi thuế quan và các TH được coi như XK": (invoice, item) => 0,
    "HH không TH trên tờ khai thuế GTGT": (invoice, item) => 0,
    "Giảm giá trị hàng nhập kho": (invoice, item) => 0,
    "Chi phí mua hàng": (invoice, item) => 0,
    "Phí hàng về kho/Chi phí mua hàng": (invoice, item) => 0,
    "Phí trước hải quan": (invoice, item) => 0,
    "Nhóm HHDV mua vào": (invoice, item) => "1",

    // Shared or conditional text descriptions
    "Địa chỉ": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_dchi : invoice.nban_dchi,
    "Diễn giải": (invoice, item) => invoice.type === 'selling'
        ? `Bán hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua hàng của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Diễn giải/Lý do chi/Nội dung thanh toán": (invoice, item) => invoice.type === 'selling'
        ? `Bán dịch vụ cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua dịch vụ của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Diễn giải/Lý do chi": (invoice, item) => invoice.type === 'selling'
        ? `Giảm giá/Trả lại hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Giảm giá/Trả lại hàng của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Diễn giải/Lý do nộp": (invoice, item) =>
        `Giảm giá hàng mua của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Diễn giải phiếu nhập": (invoice, item) =>
        `Nhập kho hàng từ ${invoice.type === 'selling' ? (invoice.nmua_ten || 'khách hàng') : (invoice.nban_ten || 'nhà cung cấp')} theo hóa đơn số ${invoice.so_hdon}`,
    "Trích yếu": (invoice, item) => invoice.type === 'selling'
        ? `Bán hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua hàng của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Lý do xuất": (invoice, item) =>
        `Bán hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`,
    "Ghi chú": (invoice, item) => `Hóa đơn số ${invoice.so_hdon}`,
    "Hình thức TT": (invoice, item) => {
        const httt = (invoice.httt || "").toUpperCase();
        if (httt === "TM") return 1; // Tiền mặt
        if (httt === "CK") return 2; // Chuyển khoản
        return 0; // Chưa thanh toán
    },

    // Quantities, Rates & Amounts
    "Loại tiền": (invoice, item) => invoice.dvt_te || "VND",
    "Tỷ giá": (invoice, item) => (invoice.dvt_te === "VND" || !invoice.dvt_te) ? 1 : null,
    "Mã hàng (*)": (invoice, item) => item.ma || "HH",
    "Mã hàng": (invoice, item) => item.ma || "HH",
    "Tên hàng": (invoice, item) => item.ten,
    "Mã dịch vụ (*)": (invoice, item) => item.ma || "DV",
    "Tên dịch vụ": (invoice, item) => item.ten,
    "ĐVT": (invoice, item) => item.dvt,
    "Đơn vị tính": (invoice, item) => item.dvt,
    "Số lượng": (invoice, item) => item.so_luong,
    "Số lượng theo ĐVC": (invoice, item) => item.so_luong,
    "Đơn giá": (invoice, item) => item.don_gia,
    "Đơn giá theo ĐVC": (invoice, item) => item.don_gia,
    "Đơn giá sau thuế": (invoice, item) => {
        if (!item.don_gia) return null;
        const rate = parseTaxRate(item.thue_suat);
        if (rate && typeof rate === "number") {
            return Math.round(item.don_gia * (1 + rate));
        }
        return item.don_gia;
    },
    "Thành tiền": (invoice, item) => item.thanh_tien,
    "Thành tiền quy đổi": (invoice, item) => item.thanh_tien,
    "Thành tiền QĐ": (invoice, item) => item.thanh_tien,
    "Giá trị HĐ": (invoice, item) => invoice.tong_thanh_toan,
    "Giá trị HĐ quy đổi": (invoice, item) => invoice.tong_thanh_toan,

    // Discounts
    "Tỷ lệ CK (%)": (invoice, item) => 0,
    "Tỷ lệ CK": (invoice, item) => 0,
    "Tiền chiết khấu": (invoice, item) => 0,
    "Tiền chiết khấu quy đổi": (invoice, item) => 0,
    "Tiền chiết khấu QĐ": (invoice, item) => 0,
    "Tiền CK": (invoice, item) => 0,
    "Tiền CK QĐ": (invoice, item) => 0,

    // Tax fields
    "% thuế GTGT": (invoice, item) => parseTaxRate(item.thue_suat),
    "Tiền thuế GTGT": (invoice, item) => item.tien_thue,
    "Tiền thuế GTGT quy đổi": (invoice, item) => item.tien_thue,
    "Tiền thuế GTGT QĐ": (invoice, item) => item.tien_thue,

    // Cost of Goods Sold details
    "Đơn giá vốn": (invoice, item) => item.don_gia,
    "Tiền vốn": (invoice, item) => item.thanh_tien,

    // Dates & Terms
    "Ngày báo giá (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày báo giá": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày giao hàng": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày phiếu nhập": (invoice, item) => formatDate(invoice.ngay_lap),
    "Hiệu lực đến": (invoice, item) => formatDate(invoice.ngay_lap),
    "Địa điểm giao hàng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_dchi : invoice.nban_dchi,
    "Số ngày được nợ": (invoice, item) => 30,
    "Điều khoản thanh toán": (invoice, item) => "Thanh toán trong 30 ngày",
};

// Memoize template headers to avoid re-reading the same Excel file repeatedly
const _templateHeaderCache = new Map();

function getTemplateHeaders(templatePath) {
    if (_templateHeaderCache.has(templatePath)) {
        return _templateHeaderCache.get(templatePath);
    }
    const templateBuffer = fs.readFileSync(templatePath);
    const workbook = xlsx.read(templateBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    const result = {
        headers: data[0] || [],
        sheetName: firstSheetName
    };
    _templateHeaderCache.set(templatePath, result);
    return result;
}

/**
 * Kiểm tra nhanh xem file Excel đã tồn tại có còn là file mẫu MISA hợp lệ
 * (đúng sheet + đúng tiêu đề cột) hay không.
 * Nếu file đã bị ghi hỏng do race condition của phiên bản cũ (sheet lạ,
 * mất header, !ref sai...) thì trả về false → sẽ tạo lại từ template gốc.
 */
function isUsableExistingFile(existingPath, templatePath) {
    try {
        const { headers: templateHeaders, sheetName: templateSheetName } = getTemplateHeaders(templatePath);
        if (!templateHeaders || templateHeaders.length === 0) return false;

        const buffer = fs.readFileSync(existingPath);
        const workbook = xlsx.read(buffer, { type: 'buffer' });
        if (!workbook.SheetNames || workbook.SheetNames.length === 0) return false;

        const sheetName = workbook.SheetNames[0];
        // Sheet name không khớp → file đã bị hỏng/sửa sai
        if (sheetName !== templateSheetName) return false;

        const worksheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
        const existingHeaders = rows[0] || [];

        // Header phải đủ dài và khớp ít nhất 60% với template gốc
        if (existingHeaders.length < 5) return false;
        let matchCount = 0;
        const len = Math.min(existingHeaders.length, templateHeaders.length);
        for (let i = 0; i < len; i++) {
            if (String(existingHeaders[i] || '') === String(templateHeaders[i] || '')) matchCount++;
        }
        const ratio = len > 0 ? matchCount / len : 0;
        return ratio >= 0.6;
    } catch (e) {
        return false;
    }
}

// Reusable column autofit utility
function autofitColumns(rows, numCols) {
    const wscols = new Array(numCols);
    for (let c = 0; c < numCols; c++) {
        let maxLen = 0;
        for (let r = 0; r < rows.length; r++) {
            const val = rows[r][c];
            if (val !== undefined && val !== null) {
                const len = String(val).length;
                if (len > maxLen) maxLen = len;
            }
        }
        wscols[c] = { wch: Math.min(maxLen + 2, 45) };
    }
    return wscols;
}

function fillTemplate(invoice, templateFile, templateDir) {
    const templatePath = path.join(templateDir, templateFile);
    const { headers, sheetName } = getTemplateHeaders(templatePath);

    const dataRows = [];
    const items = invoice.items || [];

    const loopItems = items.length > 0 ? items : [{}];

    loopItems.forEach(item => {
        const row = headers.map(header => {
            const mapper = valueMapper[header];
            if (mapper) {
                return mapper(invoice, item);
            }
            return null;
        });
        dataRows.push(row);
    });

    const wb = xlsx.readFile(templatePath, { cellStyles: true });
    const ws = wb.Sheets[sheetName];

    // Ghi dữ liệu trực tiếp ngay dưới dòng tiêu đề (tại Row 2, row index 1)
    // để không bị đẩy xuống sau hàng trăm dòng trống có sẵn của file mẫu MISA
    xlsx.utils.sheet_add_aoa(ws, dataRows, { origin: { r: 1, c: 0 } });

    // Cập nhật lại phạm vi hiển thị (!ref) vừa khít với dữ liệu thực tế
    ws['!ref'] = xlsx.utils.encode_range({
        s: { r: 0, c: 0 },
        e: { r: dataRows.length, c: Math.max(headers.length - 1, 0) }
    });

    return wb;
}

/**
 * Parses and processes a single XML file, matching it with a MISA template and generating an Excel file.
 * 
 * @param {string} xmlPath - Path to the XML invoice file
 * @param {string} templateDir - Directory containing the MISA Excel templates
 * @param {string} [type] - 'buying' or 'selling' (defaults to 'buying')
 * @param {string} [outputDir] - Directory to write the output Excel file. If omitted, saves in the same directory as the XML file.
 * @returns {object} Result summary
 */
function processInvoiceXMLFile(xmlPath, templateDir, type = 'buying', outputDir = null, activeMst = null, forceTemplate = null) {
    if (!fs.existsSync(xmlPath)) {
        throw new Error(`XML file does not exist: ${xmlPath}`);
    }
    if (!fs.existsSync(templateDir)) {
        throw new Error(`Templates directory does not exist: ${templateDir}`);
    }

    const invoice = parseInvoiceXML(xmlPath);
    if (!invoice) {
        throw new Error(`Could not parse invoice XML at ${xmlPath}`);
    }

    // Auto-detect buying vs selling if activeMst is provided
    const originalType = type;
    if (activeMst) {
        if (invoice.nban_mst === activeMst) {
            type = 'selling';
        } else if (invoice.nmua_mst === activeMst) {
            type = 'buying';
        }
    }

    // If type changed after auto-detection, adjust templateDir to the correct sibling folder
    if (type !== originalType) {
        const parentDir = path.dirname(templateDir);
        const candidates = (type === 'selling' || type === 'ban-ra') ? ['ban-ra', 'selling'] : ['mua-vao', 'buying'];
        for (const folder of candidates) {
            const correctedDir = path.join(parentDir, folder);
            if (fs.existsSync(correctedDir)) {
                templateDir = correctedDir;
                break;
            }
        }
    }

    // Set context type so mapper functions can make correct buying/selling decisions
    invoice.type = type;

    let best;
    const rankings = classifyInvoice(invoice, type);

    if (forceTemplate) {
        const found = rankings.find(t => t.file === forceTemplate);
        if (found) {
            best = { ...found, score: 100 };
        } else {
            best = { file: forceTemplate, name: forceTemplate, score: 100 };
        }
    } else {
        best = rankings[0];
    }

    // Set template name so mapper functions can check it
    invoice.template = best ? best.file : null;

    if (!best || best.score <= 0) {
        return {
            success: false,
            invoice,
            reason: "No matching template found with high enough confidence."
        };
    }

    const templatePath = path.join(templateDir, best.file);
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Recommended template file not found: ${best.file} in ${templateDir}`);
    }

    let finalOutputDir = outputDir || path.dirname(xmlPath);
    // Tự động phân loại thư mục theo Tháng/Năm (YYYY-MM) dựa trên ngày lập hóa đơn
    if (invoice.ngay_lap && String(invoice.ngay_lap).length >= 7) {
        const periodFolder = String(invoice.ngay_lap).substring(0, 7); // YYYY-MM
        finalOutputDir = path.join(finalOutputDir, periodFolder);
    }

    if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, { recursive: true });
    }

    const xmlFile = path.basename(xmlPath);
    const outFileName = best.file; // Giữ nguyên đuôi .xls
    const outPath = path.join(finalOutputDir, outFileName);

    let workbook;
    const templatePathForCheck = path.join(templateDir, best.file);

    // Nếu file đích đã tồn tại nhưng KHÔNG còn là file mẫu MISA hợp lệ
    // (bị hỏng do race condition của phiên bản cũ, sheet lạ, mất header...)
    // thì tạo LẠI từ template gốc thay vì gộp vào file rác.
    const existingUsable = fs.existsSync(outPath) && isUsableExistingFile(outPath, templatePathForCheck);

    if (fs.existsSync(outPath) && existingUsable) {
        try {
            // Đọc file Excel đã tồn tại để gộp dữ liệu
            const fileBuffer = fs.readFileSync(outPath);
            workbook = xlsx.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Chuyển dữ liệu của sheet thành mảng 2 chiều để lấy headers
            const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
            const headers = rows[0] || [];

            // Tìm dòng có dữ liệu thực sự cuối cùng (bỏ qua các dòng trống của template)
            let lastDataRow = 0;
            for (let r = rows.length - 1; r >= 1; r--) {
                if (rows[r] && rows[r].some(v => v !== null && v !== undefined && String(v).trim() !== '')) {
                    lastDataRow = r;
                    break;
                }
            }
            const startRowIndex = lastDataRow + 1;

            // Ánh xạ dữ liệu dòng mới
            const items = invoice.items || [];
            const loopItems = items.length > 0 ? items : [{}];

            const dataRows = [];
            loopItems.forEach(item => {
                const row = headers.map(header => {
                    const mapper = valueMapper[header];
                    if (mapper) {
                        return mapper(invoice, item);
                    }
                    return null;
                });
                dataRows.push(row);
            });

            // Cập nhật lại sheet với dữ liệu đã gộp nối tiếp ngay sau dòng dữ liệu cuối cùng
            xlsx.utils.sheet_add_aoa(worksheet, dataRows, { origin: { r: startRowIndex, c: 0 } });

            // Cập nhật lại phạm vi hiển thị (!ref)
            worksheet['!ref'] = xlsx.utils.encode_range({
                s: { r: 0, c: 0 },
                e: { r: startRowIndex + dataRows.length - 1, c: Math.max(headers.length - 1, 0) }
            });
        } catch (readErr) {
            console.error(`Lỗi khi đọc/gộp file Excel đã tồn tại ${outPath}, tiến hành ghi mới:`, readErr);
            workbook = fillTemplate(invoice, best.file, templateDir);
        }
    } else {
        // File chưa tồn tại HOẶC file đã bị hỏng → tạo mới từ template gốc
        if (fs.existsSync(outPath) && !existingUsable) {
            console.warn(`File ${outPath} không còn là mẫu MISA hợp lệ (có thể bị hỏng), tạo lại từ template gốc.`);
        }
        workbook = fillTemplate(invoice, best.file, templateDir);
    }

    xlsx.writeFile(workbook, outPath, { bookType: 'biff8' });

    return {
        success: true,
        xmlFile,
        invoiceNumber: invoice.so_hdon,
        nbanTen: invoice.nban_ten,
        nmuaTen: invoice.nmua_ten,
        recommendedTemplate: best.file,
        recommendedTemplateName: best.name,
        score: best.score,
        outputPath: outPath
    };
}

module.exports = {
    parseInvoiceXML,
    classifyInvoice,
    fillTemplate,
    processInvoiceXMLFile
};
