package local.markdown.reader;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "ReaderFiles")
public class ReaderFilesPlugin extends Plugin {
    private final List<JSObject> pending = new ArrayList<>();
    private final ExecutorService reader = Executors.newSingleThreadExecutor();
    private static final int MAX_BYTES = 80 * 1024 * 1024;

    @Override public void load() { readIntent(getActivity().getIntent()); }
    @Override protected void handleOnNewIntent(Intent intent) { readIntent(intent); }

    @PluginMethod public void drainFiles(PluginCall call) {
        JSArray files = new JSArray();
        synchronized (pending) { for (JSObject file : pending) files.put(file); pending.clear(); }
        JSObject result = new JSObject(); result.put("files", files); call.resolve(result);
    }

    private void readIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action)) return;
        Uri uri = Intent.ACTION_VIEW.equals(action) ? intent.getData() : intent.getParcelableExtra(Intent.EXTRA_STREAM);
        if (uri == null) {
            String text = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (text != null) { JSObject file = new JSObject(); file.put("name", "分享的内容.md"); file.put("content", text); enqueue(file); }
            return;
        }
        reader.execute(() -> {
            JSObject file = new JSObject();
            try (InputStream input = getActivity().getContentResolver().openInputStream(uri);
                 ByteArrayOutputStream output = new ByteArrayOutputStream()) {
                if (input == null) throw new Exception("文件无法读取");
                String name = resolveName(uri);
                String mime = getActivity().getContentResolver().getType(uri);
                if (!name.contains(".")) {
                    name += "application/pdf".equals(mime) ? ".pdf" :
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document".equals(mime) ? ".docx" : ".md";
                }
                file.put("name", name);
                byte[] buffer = new byte[32768]; int read, total = 0;
                while ((read = input.read(buffer)) != -1) {
                    total += read;
                    if (total > MAX_BYTES) throw new Exception("文件超过 80 MB，请选择较小的文件。");
                    output.write(buffer, 0, read);
                }
                file.put("base64", Base64.encodeToString(output.toByteArray(), Base64.NO_WRAP));
            } catch (Exception error) { file.put("error", error.getMessage() == null ? "文件无法读取，请从应用内重新打开。" : error.getMessage()); }
            enqueue(file);
        });
    }
    private void enqueue(JSObject file) {
        synchronized (pending) { pending.add(file); }
        notifyListeners("fileReady", new JSObject());
    }
    private String resolveName(Uri uri) {
        try (Cursor cursor = getActivity().getContentResolver().query(uri, null, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                if (index >= 0 && cursor.getString(index) != null) return cursor.getString(index);
            }
        } catch (Exception ignored) { }
        String name = uri.getLastPathSegment();
        return name == null || name.isEmpty() ? "打开的文档" : name;
    }
    @Override protected void handleOnDestroy() { reader.shutdownNow(); }
}
