import os
from google_auth_oauthlib.flow import InstalledAppFlow

# The scope for full Google Drive access
SCOPES = ['https://www.googleapis.com/auth/drive']

def get_tokens():
    # Get the directory where this script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    client_secret_path = os.path.join(script_dir, 'client_secret.json')
    
    # This flow is designed specifically for Desktop apps
    flow = InstalledAppFlow.from_client_secrets_file(client_secret_path, SCOPES)
    
    # This will open your web browser automatically to log in
    # prompt='consent' ensures you get a REFRESH_TOKEN even if you've logged in before
    creds = flow.run_local_server(port=0, prompt='consent')
    
    print("\n--- YOUR CREDENTIALS ---")
    print(f"GOOGLE_CLIENT_ID={creds.client_id}")
    print(f"GOOGLE_CLIENT_SECRET={creds.client_secret}")
    print(f"GOOGLE_REFRESH_TOKEN={creds.refresh_token}")
    print("------------------------")

if __name__ == '__main__':
    get_tokens()