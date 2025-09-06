<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>إعدادات الطفل</title>
  <link rel="stylesheet" href="./css/child-edit.css" />
</head>
<body>
  <div class="container" id="childEditPage">
    <div class="top">
      <h1>إعدادات الطفل</h1>
      <span id="childIdBadge" class="badge">—</span>
      <div class="grow"></div>
      <button id="btnRefresh" class="btn ghost" type="button">تحديث ↻</button>
    </div>

    <section class="card">
      <h2>البيانات العامة</h2>
      <div class="grid-2">
        <div>
          <label for="f_name">اسم الطفل</label>
          <input id="f_name" type="text" placeholder="اسم الطفل" />
        </div>
        <div>
          <label for="f_gender">النوع</label>
          <select id="f_gender">
            <option value="">—</option>
            <option value="male">ذكر</option>
            <option value="female">أنثى</option>
          </select>
        </div>
        <div>
          <label for="f_birthDate">تاريخ الميلاد</label>
          <input id="f_birthDate" type="date" />
        </div>
        <div>
          <label for="f_unit">وحدة القياس</label>
          <select id="f_unit">
            <option value="">—</option>
            <option value="mmol">mmol</option>
            <option value="mgdl">mg/dL</option>
          </select>
        </div>
        <div>
          <label for="f_deviceName">اسم الجهاز</label>
          <input id="f_deviceName" type="text" placeholder="Dexcom / Libre ..." />
        </div>
        <div>
          <label for="f_weightKg">الوزن (كجم)</label>
          <input id="f_weightKg" type="number" step="0.1" />
        </div>
        <div>
          <label for="f_heightCm">الطول (سم)</label>
          <input id="f_heightCm" type="number" step="0.1" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>الأنسولين</h2>
      <div class="grid-2">
        <div>
          <label for="f_basalType">نوع الجرعة القاعدية</label>
          <input id="f_basalType" type="text" placeholder="Lantus / Tresiba ..." />
        </div>
        <div>
          <label for="f_bolusType">نوع الجرعة السريعة</label>
          <input id="f_bolusType" type="text" placeholder="NovoRapid / Humalog ..." />
        </div>

        <div>
          <label for="f_longInsulin">الأنسولين طويل المفعول</label>
          <input id="f_longInsulin" type="text" />
        </div>
        <div>
          <label for="f_longTime">وقت الجرعة</label>
          <input id="f_longTime" type="time" />
        </div>
        <div>
          <label for="f_longUnits">الجرعة (وحدة)</label>
          <input id="f_longUnits" type="number" step="0.1" />
        </div>

        <div>
          <label for="f_carbRatio">Carb Ratio</label>
          <input id="f_carbRatio" type="number" step="0.1" />
        </div>
        <div>
          <label for="f_correctionFactor">Correction Factor</label>
          <input id="f_correctionFactor" type="number" step="0.1" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>صافي الكارب</h2>
      <div class="grid-2">
        <div>
          <label>تفعيل صافي الكارب</label>
          <div class="row-switch">
            <span class="muted small">Use Net Carbs</span>
            <label class="switch">
              <input id="f_useNetCarbs" type="checkbox" />
              <span class="slider"></span>
            </label>
          </div>
        </div>
        <div>
          <label>قاعدة صافي الكارب</label>
          <select id="f_netCarbRule">
            <option value="">—</option>
            <option value="fiber-only">خصم الألياف فقط</option>
            <option value="fiber-sugar-alcohol">خصم الألياف وكحولات السكر</option>
          </select>
        </div>
      </div>
    </section>

    <section class="card">
      <h2>مستهدفات الكارب</h2>
      <div class="grid-2">
        <div>
          <label for="f_carb_b_min">فطور Min</label>
          <input id="f_carb_b_min" type="number" />
        </div>
        <div>
          <label for="f_carb_b_max">فطور Max</label>
          <input id="f_carb_b_max" type="number" />
        </div>

        <div>
          <label for="f_carb_l_min">غداء Min</label>
          <input id="f_carb_l_min" type="number" />
        </div>
        <div>
          <label for="f_carb_l_max">غداء Max</label>
          <input id="f_carb_l_max" type="number" />
        </div>

        <div>
          <label for="f_carb_d_min">عشاء Min</label>
          <input id="f_carb_d_min" type="number" />
        </div>
        <div>
          <label for="f_carb_d_max">عشاء Max</label>
          <input id="f_carb_d_max" type="number" />
        </div>

        <div>
          <label for="f_carb_s_min">سناك Min</label>
          <input id="f_carb_s_min" type="number" />
        </div>
        <div>
          <label for="f_carb_s_max">سناك Max</label>
          <input id="f_carb_s_max" type="number" />
        </div>
      </div>
    </section>

    <section class="card">
      <h2>نطاقات السكر</h2>
      <div class="grid-2">
        <div>
          <label for="f_norm_min">النطاق الطبيعي Min</label>
          <input id="f_norm_min" type="number" />
        </div>
        <div>
          <label for="f_norm_max">النطاق الطبيعي Max</label>
          <input id="f_norm_max" type="number" />
        </div>
        <div>
          <label for="f_hypo">Hypo</label>
          <input id="f_hypo" type="number" />
        </div>
        <div>
          <label for="f_hyper">Hyper</label>
          <input id="f_hyper" type="number" />
        </div>
        <div>
          <label for="f_severeLow">Severe Low</label>
          <input id="f_severeLow" type="number" />
        </div>
        <div>
          <label for="f_severeHigh">Severe High</label>
          <input id="f_severeHigh" type="number" />
        </div>
      </div>

      <div class="row">
        <div class="doctor">
          <div class="muted small">حالة الربط بالطبيب</div>
          <div id="doctorState" class="badge">—</div>
        </div>
        <div class="grow"></div>
        <div class="buttons">
          <button id="btnLinkDoctor"  class="btn ghost" type="button">ربط الطبيب</button>
          <button id="btnUnlinkDoctor" class="btn ghost" type="button">إلغاء الربط</button>
        </div>
      </div>

      <div class="row-switch">
        <span class="muted small">موافقة مشاركة البيانات مع الطبيب</span>
        <label class="switch">
          <input id="f_shareDoctor" type="checkbox" />
          <span class="slider"></span>
        </label>
      </div>
      <div id="linkStatus" class="status"></div>
    </section>

    <div class="form-actions">
      <button id="btnBack" class="btn back" type="button">رجوع</button>
      <button id="btnSave" class="btn" type="button">حفظ التغييرات ✅</button>
    </div>
  </div>

  <div id="loader" class="loader hidden" aria-live="polite"></div>
  <div id="toast" class="toast hidden"><div class="msg">تم</div></div>

  <script type="module" src="./js/child-edit.js"></script>
</body>
</html>
