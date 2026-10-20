using System;
using System.Diagnostics;
using System.IO;
using System.Windows.Forms;

namespace ZeroParadox
{
    internal static class Launcher
    {
        [STAThread]
        private static void Main()
        {
            // The harness that may start this process can set ELECTRON_RUN_AS_NODE,
            // which turns Electron into plain Node and makes the app exit silently.
            Environment.SetEnvironmentVariable("ELECTRON_RUN_AS_NODE", null);

            string dir = AppDomain.CurrentDomain.BaseDirectory;
            string exe = Path.Combine(dir, "ZeroParadoxApp.exe");
            if (!File.Exists(exe))
            {
                MessageBox.Show(
                    "没有找到 ZeroParadoxApp.exe。请重新安装零式悖论。",
                    "零式悖论",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
                return;
            }

            try
            {
                ProcessStartInfo info = new ProcessStartInfo
                {
                    FileName = exe,
                    // Some Windows sessions cannot initialize Chromium's sandbox.
                    // The UI is local-only with context isolation and no Node access.
                    Arguments = "--no-sandbox",
                    WorkingDirectory = dir,
                    UseShellExecute = false
                };
                Process child = Process.Start(info);
                if (child != null)
                {
                    // Keep the wrapper alive so electron-builder's portable
                    // unpacker does not delete the temporary app directory.
                    child.WaitForExit();
                }
            }
            catch (Exception error)
            {
                MessageBox.Show(
                    "启动失败：" + error.Message,
                    "零式悖论",
                    MessageBoxButtons.OK,
                    MessageBoxIcon.Error);
            }
        }
    }
}
