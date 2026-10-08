package ru.kb911.generatorb3d;

import android.app.Activity;
import android.app.AlertDialog;
import android.os.Bundle;
import android.content.Intent;
import android.net.Uri;
import android.graphics.Color;
import android.view.View;
import android.widget.*;
import org.json.JSONObject;
import java.util.*;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.text.SimpleDateFormat;

public final class MainActivity extends Activity {
    private LinearLayout root, rows, toolbar;
    private TextView title, status;
    private Button back, refresh, settings, delete;
    private String project;
    private boolean busy;
    private final Set<JSONObject> selected = new LinkedHashSet<>();
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
    private Button button(String caption) { Button b = new Button(this); b.setText(caption); b.setAllCaps(false); return b; }
    private TextView text(String value, int size) { TextView v = new TextView(this); v.setText(value); v.setTextSize(size); v.setTextColor(Color.rgb(36, 43, 52)); return v; }
    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        if (state != null) project = state.getString("project");
        root = new LinearLayout(this); root.setOrientation(LinearLayout.VERTICAL); root.setPadding(dp(16), dp(12), dp(16), dp(12)); root.setBackgroundColor(Color.rgb(246, 247, 249));
        // Insets keep controls clear of Android 15 edge-to-edge navigation and status bars.
        root.setOnApplyWindowInsetsListener((view, insets) -> { view.setPadding(dp(16)+insets.getSystemWindowInsetLeft(), dp(12)+insets.getSystemWindowInsetTop(), dp(16)+insets.getSystemWindowInsetRight(), dp(12)+insets.getSystemWindowInsetBottom()); return insets; });
        title = text("Generator B3D", 24); root.addView(title);
        toolbar = new LinearLayout(this);
        back = button("Проекты"); refresh = button("Обновить"); settings = button("Настройки");
        toolbar.addView(back, new LinearLayout.LayoutParams(0, dp(52), 1)); toolbar.addView(refresh, new LinearLayout.LayoutParams(0, dp(52), 1)); toolbar.addView(settings, new LinearLayout.LayoutParams(0, dp(52), 1)); root.addView(toolbar);
        status = text("", 14); status.setPadding(0, dp(8), 0, dp(8)); root.addView(status);
        ScrollView scroll = new ScrollView(this); rows = new LinearLayout(this); rows.setOrientation(LinearLayout.VERTICAL); scroll.addView(rows); root.addView(scroll, new LinearLayout.LayoutParams(-1, 0, 1));
        delete = button("Удалить выбранные"); root.addView(delete); setContentView(root);
        back.setOnClickListener(v -> { project = null; load(); }); refresh.setOnClickListener(v -> load()); settings.setOnClickListener(v -> showSettings()); delete.setOnClickListener(v -> confirmDelete());
        try { if (SecretStore.read(this).isEmpty()) { showSettings(); status.setText("Укажите ключ публикации, чтобы открыть хранилище."); } else load(); } catch (Exception e) { status.setText("Заново сохраните ключ в настройках."); showSettings(); }
        updateButtons();
    }
    @Override public void onSaveInstanceState(Bundle state) { super.onSaveInstanceState(state); state.putString("project", project); }
    @Override public void onDestroy() { worker.shutdown(); super.onDestroy(); }
    @Override public void onBackPressed() { if (project != null && !busy) { project = null; load(); } else if (!busy) super.onBackPressed(); }
    private ModelsApi api() throws Exception { return new ModelsApi(getSharedPreferences("publication", MODE_PRIVATE).getString("base", "https://kb911.ru"), SecretStore.read(this)); }
    private void updateButtons() {
        back.setEnabled(!busy && project != null); refresh.setEnabled(!busy); settings.setEnabled(!busy);
        delete.setVisibility(project == null ? View.GONE : View.VISIBLE); delete.setEnabled(!busy && !selected.isEmpty()); delete.setText("Удалить выбранные (" + selected.size() + ")");
    }
    private void load() {
        if (busy) return;
        final ModelsApi client; try { client = api(); } catch (Exception e) { status.setText(e.getMessage()); return; }
        final String currentProject = project;
        busy = true; selected.clear(); rows.removeAllViews(); updateButtons(); title.setText(currentProject == null ? "3D модели" : currentProject); status.setText("Загрузка списка…");
        worker.execute(() -> {
            try {
                List<JSONObject> items = client.list(currentProject);
                items.sort(Comparator.comparing(o -> o.optString(currentProject == null ? "name" : "model"), String.CASE_INSENSITIVE_ORDER));
                runOnUiThread(() -> { if (isDestroyed()) return; busy = false; render(items, client); status.setText(items.isEmpty() ? "Пока нет моделей. Опубликуйте HTML из Generator B3D." : "Всего: " + items.size()); updateButtons(); });
            } catch (Exception e) { runOnUiThread(() -> { if (isDestroyed()) return; busy = false; status.setText(message(e)); updateButtons(); }); }
        });
    }
    private void render(List<JSONObject> items, ModelsApi client) {
        for (JSONObject item : items) {
            if (project == null) {
                LinearLayout row = new LinearLayout(this);
                Button open = button("▸ " + item.optString("name"));
                row.addView(open, new LinearLayout.LayoutParams(0, -2, 1));
                String count = item.isNull("views") || !item.has("views") ? "—" : java.text.NumberFormat.getIntegerInstance().format(item.optLong("views"));
                TextView views = text(count + "\nоткрытий", 14); views.setGravity(android.view.Gravity.RIGHT | android.view.Gravity.CENTER_VERTICAL); views.setPadding(dp(12), 0, 0, 0);
                views.setContentDescription(item.isNull("views") || !item.has("views") ? "Счётчик открытий недоступен" : "Открытий файлов проекта: " + count);
                row.addView(views, new LinearLayout.LayoutParams(-2, -1)); rows.addView(row);
                open.setOnClickListener(v -> { project = item.optString("name"); load(); });
            } else {
                LinearLayout row = new LinearLayout(this); row.setPadding(0, dp(6), 0, dp(6));
                CheckBox check = new CheckBox(this); row.addView(check, new LinearLayout.LayoutParams(dp(48), dp(64)));
                LinearLayout details = new LinearLayout(this); details.setOrientation(LinearLayout.VERTICAL); details.setPadding(dp(8), dp(8), 0, dp(8));
                details.addView(text(item.optString("model"), 18)); details.addView(text(date(item.optString("updatedAt")) + "  ·  " + String.format(Locale.getDefault(), "%.2f МБ", item.optLong("size") / 1048576.0), 13)); row.addView(details, new LinearLayout.LayoutParams(0, -2, 1)); rows.addView(row);
                check.setOnCheckedChangeListener((b, value) -> { if (value && selected.size() >= 100) { b.setChecked(false); Toast.makeText(this, "До 100 моделей за одно удаление", Toast.LENGTH_SHORT).show(); return; } if (value) selected.add(item); else selected.remove(item); updateButtons(); });
                details.setOnClickListener(v -> { if (busy) return; try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(client.modelURL(item)))); } catch (Exception e) { status.setText("Не удалось открыть ссылку: " + message(e)); } });
            }
        }
    }
    private String date(String raw) { try { SimpleDateFormat source = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US); source.setTimeZone(TimeZone.getTimeZone("UTC")); return new SimpleDateFormat("dd.MM.yyyy HH:mm", Locale.getDefault()).format(source.parse(raw)); } catch (Exception ignored) { return raw; } }
    private String message(Exception e) { if (e instanceof java.io.IOException) return "Нет связи с сервером. Нажмите «Обновить» позже."; return e.getMessage() == null ? "Не удалось выполнить запрос" : e.getMessage(); }
    private void confirmDelete() {
        if (busy || selected.isEmpty()) return;
        List<JSONObject> files = new ArrayList<>(selected); StringBuilder names = new StringBuilder(); for (JSONObject file : files) names.append(file.optString("model")).append('\n');
        new AlertDialog.Builder(this).setTitle("Удалить модели: " + files.size() + "?").setMessage(names.toString()).setNegativeButton("Отмена", null).setPositiveButton("Удалить", (dialog, which) -> remove(files)).show();
    }
    private void remove(List<JSONObject> files) {
        final ModelsApi client; try { client = api(); } catch (Exception e) { status.setText(message(e)); return; }
        busy = true; updateButtons(); status.setText("Удаление моделей…");
        worker.execute(() -> {
            try { client.delete(files); runOnUiThread(() -> { if (isDestroyed()) return; busy = false; load(); }); }
            catch (Exception e) { runOnUiThread(() -> { if (isDestroyed()) return; busy = false; status.setText(message(e) + " Обновите список перед повторным удалением."); selected.clear(); rows.removeAllViews(); updateButtons(); }); }
        });
    }
    private void showSettings() {
        LinearLayout form = new LinearLayout(this); form.setOrientation(LinearLayout.VERTICAL); form.setPadding(dp(20), dp(12), dp(20), dp(12));
        EditText base = new EditText(this); base.setSingleLine(true); base.setInputType(17); base.setText(getSharedPreferences("publication", MODE_PRIVATE).getString("base", "https://kb911.ru")); form.addView(text("Адрес сайта", 14)); form.addView(base);
        EditText key = new EditText(this); key.setSingleLine(true); key.setInputType(129); key.setHint("Ключ публикации"); form.addView(text("Ключ (пустое поле сохраняет текущий)", 14)); form.addView(key);
        form.addView(text("Ключ защищён Android Keystore и не хранится в APK.", 13));
        AlertDialog dialog = new AlertDialog.Builder(this).setTitle("Хранилище 3D моделей").setView(form).setNegativeButton("Отмена", null).setPositiveButton("Сохранить", null).create();
        dialog.setOnShowListener(d -> dialog.getButton(AlertDialog.BUTTON_POSITIVE).setOnClickListener(v -> {
            try {
                String token = key.getText().toString().trim(); if (token.isEmpty()) token = SecretStore.read(this);
                ModelsApi checked = new ModelsApi(base.getText().toString().trim(), token);
                SecretStore.save(this, token); getSharedPreferences("publication", MODE_PRIVATE).edit().putString("base", checked.base).apply(); key.setText(""); dialog.dismiss(); project = null; load();
            } catch (Exception e) { key.setError(message(e)); }
        })); dialog.show();
    }
}
