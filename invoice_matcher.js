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

// Keywords and Classification Criteria
const SERVICE_KEYWORDS = [
    "dịch vụ", "phí", "bản quyền", "thuê", "bảo trì", "bảo hành",
    "tư vấn", "vận chuyển", "cước", "quảng cáo", "hosting", "domain",
    "phần mềm", "license", "subscription", "service", "lắp đặt",
    "sửa chữa", "gia công", "thiết kế", "đào tạo", "bảo hiểm",
    "internet", "điện thoại"
];

const GOODS_DVT = [
    "cái", "chiếc", "hộp", "thùng", "lốc", "kg", "tấn", "m", "m2",
    "bộ", "cuộn", "chai", "lon", "gói", "túi", "bao", "quyển", "tờ",
    "lít", "can", "bình", "hũ", "thanh", "tấm", "miếng", "viên",
    "đôi", "cây", "quả", "trái", "bịch", "tuýp", "ống"
];

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

    // Analyze item keywords
    let serviceScore = 0;
    let goodsScore = 0;
    let consumableScore = 0;
    let stockableScore = 0;

    items.forEach(item => {
        const name = (item.ten || "").toLowerCase();
        const dvt = (item.dvt || "").toLowerCase();

        if (SERVICE_KEYWORDS.some(kw => name.includes(kw))) {
            serviceScore += 2;
        }

        if (GOODS_DVT.includes(dvt)) {
            goodsScore += 2;
        } else if (["bản", "gói", "lần", "tháng", "năm"].includes(dvt)) {
            serviceScore += 1;
        } else {
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
    "Mã số thuế": (invoice, item) => invoice.nmua_mst,
    "Địa chỉ khách hàng": (invoice, item) => invoice.nmua_dchi,
    "Đối tượng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,
    "Mã đối tượng": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_mst : invoice.nban_mst,

    // Accounts Defaults
    "TK chi phí (*)": (invoice, item) => "6422",
    "TK kho (*)": (invoice, item) => "1561",
    "TK chi phí/TK kho (*)": (invoice, item) => "6422",
    "TK kho/TK chi phí (*)": (invoice, item) => "1561",
    "TK công nợ/TK tiền (*)": (invoice, item) => "331",
    "TK công nợ/TK tiền/TK có (*)": (invoice, item) => "331",
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
    "TK thuế GTGT": (invoice, item) => invoice.type === 'selling' ? "33311" : "1331",
    "TKĐƯ thuế GTGT": (invoice, item) => invoice.type === 'selling' ? "131" : "331",

    // Warehouse mappings
    "Mã kho": (invoice, item) => "156",
    "Kho": (invoice, item) => "156",
    "TK Kho": (invoice, item) => "1561",
    "TK kho": (invoice, item) => "1561",

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

    // General transaction types
    "Hình thức mua hàng": (invoice, item) => {
        // Hóa đơn điện tử lấy từ web thuế mặc định là mua hàng trong nước (1)
        return 1;
    },
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
        return 0; // Chưa thanh toán (mặc định cho các hình thức hỗn hợp như TM/CK)
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

    // Flags / Placeholders
    "Là CP mua hàng": (invoice, item) => 0,
    "Hàng khuyến mại": (invoice, item) => 0,
    "Là dòng chiết khấu thương mại": (invoice, item) => 0,

    // Shared or conditional
    "Địa chỉ": (invoice, item) => invoice.type === 'selling' ? invoice.nmua_dchi : invoice.nban_dchi,
    "Diễn giải": (invoice, item) => invoice.type === 'selling'
        ? `Bán hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua hàng của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Diễn giải/Lý do chi/Nội dung thanh toán": (invoice, item) => invoice.type === 'selling'
        ? `Bán dịch vụ cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua dịch vụ của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,
    "Trích yếu": (invoice, item) => invoice.type === 'selling'
        ? `Bán hàng cho ${invoice.nmua_ten || 'khách hàng'} theo hóa đơn số ${invoice.so_hdon}`
        : `Mua hàng của ${invoice.nban_ten || 'nhà cung cấp'} theo hóa đơn số ${invoice.so_hdon}`,

    "Loại tiền": (invoice, item) => invoice.dvt_te,
    "Tỷ giá": (invoice, item) => invoice.dvt_te === "VND" ? 1 : null,
    "Mã hàng (*)": (invoice, item) => item.ma || "HH",
    "Mã hàng": (invoice, item) => item.ma || "HH",
    "Tên hàng": (invoice, item) => item.ten,
    "Mã dịch vụ (*)": (invoice, item) => item.ma || "DV",
    "Tên dịch vụ": (invoice, item) => item.ten,
    "ĐVT": (invoice, item) => item.dvt,
    "Đơn vị tính": (invoice, item) => item.dvt,
    "Số lượng": (invoice, item) => item.so_luong,
    "Đơn giá": (invoice, item) => item.don_gia,
    "Thành tiền": (invoice, item) => item.thanh_tien,
    "Thành tiền quy đổi": (invoice, item) => item.thanh_tien,
    "Thành tiền QĐ": (invoice, item) => item.thanh_tien,
    "% thuế GTGT": (invoice, item) => parseTaxRate(item.thue_suat),
    "Tiền thuế GTGT": (invoice, item) => item.tien_thue,
    "Tiền thuế GTGT quy đổi": (invoice, item) => item.tien_thue,
    "Tiền thuế GTGT QĐ": (invoice, item) => item.tien_thue,
    "Ngày báo giá (*)": (invoice, item) => formatDate(invoice.ngay_lap),
    "Ngày báo giá": (invoice, item) => formatDate(invoice.ngay_lap),
};

function getTemplateHeaders(templatePath) {
    const templateBuffer = fs.readFileSync(templatePath);
    const workbook = xlsx.read(templateBuffer, { type: 'buffer' });
    const firstSheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[firstSheetName];
    const data = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
    return {
        headers: data[0] || [],
        sheetName: firstSheetName
    };
}

function fillTemplate(invoice, templateFile, templateDir) {
    const templatePath = path.join(templateDir, templateFile);
    const { headers, sheetName } = getTemplateHeaders(templatePath);

    // Build workbook data
    const rows = [headers];
    const items = invoice.items || [];

    // In case there are no items, write at least one line
    const loopItems = items.length > 0 ? items : [{}];

    loopItems.forEach(item => {
        const row = headers.map(header => {
            const mapper = valueMapper[header];
            if (mapper) {
                return mapper(invoice, item);
            }
            return null;
        });
        rows.push(row);
    });

    const newWb = xlsx.utils.book_new();
    const newWs = xlsx.utils.aoa_to_sheet(rows);

    // Dynamic column width autofit
    const maxCols = headers.length;
    const wscols = [];
    for (let c = 0; c < maxCols; c++) {
        let maxLen = 0;
        rows.forEach(r => {
            const val = r[c];
            if (val !== undefined && val !== null) {
                maxLen = Math.max(maxLen, String(val).length);
            }
        });
        wscols.push({ wch: Math.min(maxLen + 2, 45) });
    }
    newWs['!cols'] = wscols;

    xlsx.utils.book_append_sheet(newWb, newWs, sheetName);
    return newWb;
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
function processInvoiceXMLFile(xmlPath, templateDir, type = 'buying', outputDir = null) {
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

    // Set context type so mapper functions can make correct buying/selling decisions
    invoice.type = type;

    const rankings = classifyInvoice(invoice, type);
    const best = rankings[0];

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

    const finalOutputDir = outputDir || path.dirname(xmlPath);
    if (!fs.existsSync(finalOutputDir)) {
        fs.mkdirSync(finalOutputDir, { recursive: true });
    }

    const xmlFile = path.basename(xmlPath);
    const outFileName = `${best.file.replace('.xls', '')}.xlsx`;
    const outPath = path.join(finalOutputDir, outFileName);

    let workbook;
    if (fs.existsSync(outPath)) {
        try {
            // Đọc file Excel đã tồn tại để gộp dữ liệu
            const fileBuffer = fs.readFileSync(outPath);
            workbook = xlsx.read(fileBuffer, { type: 'buffer' });
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];

            // Chuyển dữ liệu của sheet thành mảng 2 chiều
            const rows = xlsx.utils.sheet_to_json(worksheet, { header: 1 });
            const headers = rows[0] || [];

            // Ánh xạ dữ liệu dòng mới
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
                rows.push(row);
            });

            // Cập nhật lại sheet với dữ liệu đã gộp
            const newWs = xlsx.utils.aoa_to_sheet(rows);

            // Autofit độ rộng các cột
            const maxCols = headers.length;
            const wscols = [];
            for (let c = 0; c < maxCols; c++) {
                let maxLen = 0;
                rows.forEach(r => {
                    const val = r[c];
                    if (val !== undefined && val !== null) {
                        maxLen = Math.max(maxLen, String(val).length);
                    }
                });
                wscols.push({ wch: Math.min(maxLen + 2, 45) });
            }
            newWs['!cols'] = wscols;

            workbook.Sheets[sheetName] = newWs;
        } catch (readErr) {
            console.error(`Lỗi khi đọc/gộp file Excel đã tồn tại ${outPath}, tiến hành ghi mới:`, readErr);
            workbook = fillTemplate(invoice, best.file, templateDir);
        }
    } else {
        workbook = fillTemplate(invoice, best.file, templateDir);
    }

    xlsx.writeFile(workbook, outPath);

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
