import tkinter as tk
from tkinter import ttk, messagebox, filedialog
import argparse
from datetime import date, datetime, timedelta
from pathlib import Path
import yfinance as yf
import pandas as pd
import threading

class EODDownloaderApp:
    DOWNLOAD_TARGETS = [
        {"yf_ticker": "^JKSE", "export_ticker": "IHSG"}
    ]
    DEFAULT_START_DATE = date(2023, 1, 1)

    def __init__(self, root):
        self.root = root
        self.root.title("EOD Data Downloader - IHSG Only (^JKSE)") # Ubah Title
        self.root.geometry("500x400")
        
        # Create and pack the main frame
        self.main_frame = ttk.Frame(root, padding="10")
        self.main_frame.grid(row=0, column=0, sticky=(tk.W, tk.E, tk.N, tk.S))
        
        # Configure grid weights for responsiveness
        root.columnconfigure(0, weight=1)
        root.rowconfigure(0, weight=1)
        self.main_frame.columnconfigure(1, weight=1)
        
        # Date selection widgets
        ttk.Label(self.main_frame, text="Start Date (YYYY-MM-DD):").grid(row=0, column=0, sticky=tk.W, pady=5)
        self.start_date_var = tk.StringVar(value=self.DEFAULT_START_DATE.strftime('%Y-%m-%d'))
        self.start_date_entry = ttk.Entry(self.main_frame, textvariable=self.start_date_var)
        self.start_date_entry.grid(row=0, column=1, sticky=(tk.W, tk.E), pady=5, padx=(5, 0))
        
        ttk.Label(self.main_frame, text="End Date (YYYY-MM-DD):").grid(row=1, column=0, sticky=tk.W, pady=5)
        self.end_date_var = tk.StringVar(value=date.today().strftime('%Y-%m-%d'))
        self.end_date_entry = ttk.Entry(self.main_frame, textvariable=self.end_date_var)
        self.end_date_entry.grid(row=1, column=1, sticky=(tk.W, tk.E), pady=5, padx=(5, 0))
        
        # Download button
        self.download_btn = ttk.Button(self.main_frame, text="Download IHSG Data", command=self.start_download)
        self.download_btn.grid(row=2, column=0, columnspan=2, pady=20, ipadx=10, ipady=5)
        
        # Progress bar
        self.progress = ttk.Progressbar(self.main_frame, mode='indeterminate')
        self.progress.grid(row=3, column=0, columnspan=2, sticky=(tk.W, tk.E), pady=5)
        
        # Status text area
        self.status_text = tk.Text(self.main_frame, height=15, width=60, wrap=tk.WORD)
        self.status_text.grid(row=4, column=0, columnspan=2, sticky=(tk.W, tk.E, tk.N, tk.S), pady=10)
        self.main_frame.rowconfigure(4, weight=1)
        
        # Scrollbar for text area
        scrollbar = ttk.Scrollbar(self.main_frame, orient=tk.VERTICAL, command=self.status_text.yview)
        scrollbar.grid(row=4, column=2, sticky=(tk.N, tk.S))
        self.status_text.configure(yscrollcommand=scrollbar.set)
        
        # --- MODIFIKASI: HANYA IHSG ---
        # Simpan kode Yahoo Finance dan kode output terpisah agar hasil file lebih rapi.
        self.download_targets = self.DOWNLOAD_TARGETS
        self.log_message("System Ready: Target set to IHSG (^JKSE) only.")
    
    def log_message(self, message):
        """Add a message to the status text area"""
        self.status_text.insert(tk.END, f"{message}\n")
        self.status_text.see(tk.END)
        self.root.update_idletasks()

    @staticmethod
    def emit_log(logger, message):
        """Send a log message to the provided logger if one exists."""
        if logger is not None:
            logger(message)

    @staticmethod
    def normalize_yfinance_data(data):
        """Normalize yfinance output so the export logic always sees flat OHLCV columns."""
        normalized = data.copy()

        if isinstance(normalized.columns, pd.MultiIndex):
            normalized.columns = normalized.columns.get_level_values(0)

        normalized.reset_index(inplace=True)

        if 'Adj Close' in normalized.columns:
            normalized = normalized.drop(columns=['Adj Close'])

        required_cols = ['Date', 'Open', 'High', 'Low', 'Close', 'Volume']
        missing_cols = [col for col in required_cols if col not in normalized.columns]
        if missing_cols:
            raise ValueError(f"Missing columns from data source: {', '.join(missing_cols)}")

        return normalized[required_cols].copy()

    @staticmethod
    def build_fms_export(data, export_ticker):
        """Convert OHLCV data to the fms text layout shown in the sample file."""
        formatted = data.copy()
        formatted['Date'] = pd.to_datetime(formatted['Date'])
        formatted.sort_values(['Date'], inplace=True)

        for col in ['Open', 'High', 'Low', 'Close']:
            formatted[col] = pd.to_numeric(formatted[col], errors='coerce').round(3)

        formatted['Volume'] = pd.to_numeric(formatted['Volume'], errors='coerce').fillna(0).astype('int64')

        formatted['Date'] = formatted['Date'].dt.strftime('%m/%d/%Y')
        formatted['Ticker'] = export_ticker
        formatted['Freq'] = 0
        formatted['Valuasi'] = 0
        formatted['Nbsa'] = 0

        formatted.rename(columns={
            'Date': '<date>',
            'Ticker': '<ticker>',
            'Open': '<open>',
            'High': '<high>',
            'Low': '<low>',
            'Close': '<close>',
            'Volume': '<volume>',
            'Freq': '<freq>',
            'Valuasi': '<valuasi>',
            'Nbsa': '<nbsa>',
        }, inplace=True)

        return formatted[
            ['<date>', '<ticker>', '<open>', '<high>', '<low>', '<close>', '<volume>', '<freq>', '<valuasi>', '<nbsa>']
        ]

    @staticmethod
    def build_default_filename(export_date):
        """Build the default export file name in IHSG + YYYYMMDD format."""
        return f"IHSG{export_date.strftime('%Y%m%d')}.txt"

    @staticmethod
    def get_latest_export_date(final_df):
        """Return the newest date present in the exported data."""
        export_dates = pd.to_datetime(final_df['<date>'], format='%m/%d/%Y', errors='coerce')
        latest_date = export_dates.max()
        if pd.isna(latest_date):
            return None
        return latest_date.date()

    @staticmethod
    def save_export_file(final_df, file_path):
        """Write the export file and ensure the parent directory exists."""
        output_path = Path(file_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        final_df.to_csv(output_path, index=False, lineterminator='\n')
        return output_path

    @classmethod
    def download_and_prepare_data(cls, start_date, end_date, logger=None):
        """Download, normalize, and format the IHSG export data."""
        cls.emit_log(logger, "Starting download for IHSG...")

        all_data = []
        notes = []

        for target in cls.DOWNLOAD_TARGETS:
            try:
                yf_ticker = target['yf_ticker']
                export_ticker = target['export_ticker']

                cls.emit_log(logger, f"Requesting data for {yf_ticker}...")

                # Catatan: parameter "end" di yfinance bersifat exclusive,
                # jadi kita tambah 1 hari agar tanggal akhir user tetap ikut terunduh.
                data = yf.download(
                    yf_ticker,
                    start=start_date,
                    end=end_date + timedelta(days=1),
                    auto_adjust=False,
                    progress=False
                )

                if not data.empty:
                    normalized_data = cls.normalize_yfinance_data(data)
                    formatted_data = cls.build_fms_export(normalized_data, export_ticker)

                    if not formatted_data.empty:
                        all_data.append(formatted_data)
                        cls.emit_log(logger, "  Success: Data retrieved and prepared in fms text format.")
                    else:
                        cls.emit_log(logger, "  No rows found after formatting source data.")
                else:
                    cls.emit_log(logger, "  No data found via Yahoo Finance.")

            except Exception as e:
                cls.emit_log(logger, f"  Error processing: {str(e)}")

        if not all_data:
            return None, notes

        final_df = pd.concat(all_data, ignore_index=True)
        final_df['_sort_date'] = pd.to_datetime(final_df['<date>'], format='%m/%d/%Y', errors='coerce')
        final_df.sort_values(['_sort_date', '<ticker>'], inplace=True)
        final_df.drop(columns=['_sort_date'], inplace=True)

        notes.append("Note: kolom <freq>, <valuasi>, dan <nbsa> diisi 0 karena tidak tersedia dari Yahoo Finance.")
        notes.append("Note: baris EOD yang belum lengkap tetap disimpan sesuai permintaan.")
        return final_df, notes
    
    def validate_dates(self):
        """Validate the date inputs"""
        try:
            # Fix format validation
            start_date = datetime.strptime(self.start_date_var.get(), '%Y-%m-%d').date()
            end_date = datetime.strptime(self.end_date_var.get(), '%Y-%m-%d').date()
            
            if start_date > end_date:
                raise ValueError("Start date must be before end date")
                
            return start_date, end_date
        except ValueError as e:
            messagebox.showerror("Invalid Date", f"Please enter valid dates in YYYY-MM-DD format.\nError: {str(e)}")
            return None, None
    
    def download_data(self):
        """Download EOD data for IHSG"""
        start_date, end_date = self.validate_dates()
        if not start_date or not end_date:
            return
        
        self.download_btn.config(state=tk.DISABLED)
        self.progress.start()
        
        try:
            final_df, notes = self.download_and_prepare_data(start_date, end_date, logger=self.log_message)

            if final_df is not None:
                export_date = self.get_latest_export_date(final_df) or end_date
                filename = self.build_default_filename(export_date)
                
                file_path = filedialog.asksaveasfilename(
                    defaultextension=".txt",
                    filetypes=[("Text files", "*.txt"), ("All files", "*.*")],
                    initialfile=filename
                )
                
                if file_path:
                    self.save_export_file(final_df, file_path)
                    for note in notes:
                        self.log_message(note)
                    self.log_message(f"\nSUCCESS! Data saved to:\n{file_path}")
                    messagebox.showinfo("Success", f"Data saved.")
                else:
                    self.log_message("\nDownload cancelled.")
            else:
                self.log_message("\nNo data downloaded.")
                
        except Exception as e:
            self.log_message(f"\nCritical Error: {str(e)}")
            messagebox.showerror("Error", str(e))
        finally:
            self.progress.stop()
            self.download_btn.config(state=tk.NORMAL)
    
    def start_download(self):
        thread = threading.Thread(target=self.download_data)
        thread.daemon = True
        thread.start()


def parse_cli_date(raw_value, arg_name):
    """Parse YYYY-MM-DD CLI arguments into date objects."""
    try:
        return datetime.strptime(raw_value, '%Y-%m-%d').date()
    except ValueError as exc:
        raise ValueError(f"{arg_name} must use YYYY-MM-DD format.") from exc


def run_headless_download(start_date=None, end_date=None, output_dir='.', output_file=None):
    """Run the downloader without the GUI for automation or terminal use."""
    target_end_date = end_date or date.today()
    target_start_date = start_date or EODDownloaderApp.DEFAULT_START_DATE

    if target_start_date > target_end_date:
        raise ValueError("Start date must be before or equal to end date.")

    logger = lambda message: print(message, flush=True)
    final_df, notes = EODDownloaderApp.download_and_prepare_data(target_start_date, target_end_date, logger=logger)

    if final_df is None:
        logger("No file created because no data was downloaded.")
        return 0

    if output_file:
        file_path = Path(output_file)
    else:
        export_date = EODDownloaderApp.get_latest_export_date(final_df) or target_end_date
        file_path = Path(output_dir) / EODDownloaderApp.build_default_filename(export_date)

    saved_path = EODDownloaderApp.save_export_file(final_df, file_path)

    for note in notes:
        logger(note)

    logger(f"SUCCESS! Data saved to:\n{saved_path.resolve()}")
    return 0


def build_arg_parser():
    """Create the CLI parser for GUI and headless execution modes."""
    parser = argparse.ArgumentParser(description="IHSG EOD downloader")
    parser.add_argument("--headless", action="store_true", help="Run without the Tkinter GUI.")
    parser.add_argument("--start-date", help="Start date in YYYY-MM-DD format. Defaults to 2023-01-01 in headless mode.")
    parser.add_argument("--end-date", help="End date in YYYY-MM-DD format. Defaults to today in headless mode.")
    parser.add_argument("--output-dir", default=".", help="Directory for the output file in headless mode.")
    parser.add_argument("--output-file", help="Exact output file path in headless mode.")
    return parser

def main():
    parser = build_arg_parser()
    args = parser.parse_args()

    if args.headless:
        try:
            start_date = parse_cli_date(args.start_date, "--start-date") if args.start_date else None
            end_date = parse_cli_date(args.end_date, "--end-date") if args.end_date else None
            return run_headless_download(
                start_date=start_date,
                end_date=end_date,
                output_dir=args.output_dir,
                output_file=args.output_file
            )
        except Exception as exc:
            print(f"ERROR: {exc}", flush=True)
            return 1

    root = tk.Tk()
    app = EODDownloaderApp(root)
    root.mainloop()
    return 0

if __name__ == "__main__":
    raise SystemExit(main())
