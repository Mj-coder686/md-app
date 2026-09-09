package local.markdown.reader;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;

public class MainActivity extends BridgeActivity {
    private static final int MAX_FILE_BYTES = 8 * 1024 * 1024;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        deliverMarkdownIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverMarkdownIntent(intent);
    }

    private void deliverMarkdownIntent(Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (!Intent.ACTION_VIEW.equals(action) && !Intent.ACTION_SEND.equals(action)) return;

        Uri uri = Intent.ACTION_VIEW.equals(action)
            ? intent.getData()
            : intent.getParcelableExtra(Intent.EXTRA_STREAM);

        if (uri == null && Intent.ACTION_SEND.equals(action)) {
            String sharedText = intent.getStringExtra(Intent.EXTRA_TEXT);
            if (sharedText != null) dispatchToWeb("分享的内容.md", sharedText);
            return;
        }
        if (uri == null) return;

        try (InputStream input = getContentResolver().openInputStream(uri);
             ByteArrayOutputStream output = new ByteArrayOutputStream()) {
            if (input == null) return;
            byte[] buffer = new byte[8192];
            int total = 0;
            int read;
            while ((read = input.read(buffer)) != -1) {
                total += read;
                if (total > MAX_FILE_BYTES) return;
                output.write(buffer, 0, read);
            }
            String content = output.toString(StandardCharsets.UTF_8.name());
            if (content.startsWith("\uFEFF")) content = content.substring(1);
            dispatchToWeb(resolveName(uri), content);
        } catch (Exception ignored) {
            // The in-app file picker remains available if another app sends an unreadable URI.
        }
    }

    private String resolveName(Uri uri) {
        if ("content".equals(uri.getScheme())) {
            try (Cursor cursor = getContentResolver().query(uri, null, null, null, null)) {
                if (cursor != null && cursor.moveToFirst()) {
                    int index = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (index >= 0) return cursor.getString(index);
                }
            } catch (Exception ignored) { }
        }
        String segment = uri.getLastPathSegment();
        return segment == null || segment.isEmpty() ? "打开的文档.md" : segment;
    }

    private void dispatchToWeb(String name, String content) {
        String script = "window.dispatchEvent(new CustomEvent('markdown-file-opened',{detail:{name:"
            + JSONObject.quote(name) + ",content:" + JSONObject.quote(content) + "}}));";
        getBridge().getWebView().postDelayed(
            () -> getBridge().getWebView().evaluateJavascript(script, null),
            700
        );
    }
}
