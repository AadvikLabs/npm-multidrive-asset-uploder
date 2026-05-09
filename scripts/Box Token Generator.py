import requests
import webbrowser
from http.server import BaseHTTPRequestHandler, HTTPServer
import urllib.parse as urlparse

import os

def get_env_val(key):
    # Get the directory where the script is located
    script_dir = os.path.dirname(os.path.abspath(__file__))
    # .env is back one level from the scripts folder
    env_path = os.path.join(script_dir, '..', '.env')
    try:
        with open(env_path, 'r') as f:
            for line in f:
                if line.strip().startswith(f"{key}="):
                    return line.split('=')[1].strip()
    except Exception as e:
        print(f"Debug: Error reading .env at {env_path}: {e}")
        return None
    return None

CLIENT_ID = get_env_val('BOX_CLIENT_ID')
CLIENT_SECRET = get_env_val('BOX_CLIENT_SECRET')
REDIRECT_URI = 'http://localhost:8080'

auth_code = None

class OAuthHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        global auth_code
        query = urlparse.urlparse(self.path).query
        params = urlparse.parse_qs(query)
        
        if 'code' in params:
            auth_code = params['code'][0]
            self.send_response(200)
            self.send_header('Content-type', 'text/html')
            self.end_headers()
            self.wfile.write(b"<h1>Success!</h1><p>You can close this window and return to the terminal.</p>")
        else:
            self.send_response(400)
            self.end_headers()

def get_box_tokens():
    print("--- Box Token Generator ---")
    
    # 1. Build Authorization URL
    auth_url = (
        f"https://account.box.com/api/oauth2/authorize?"
        f"response_type=code&"
        f"client_id={CLIENT_ID}&"
        f"redirect_uri={REDIRECT_URI}"
    )
    
    print(f"\n1. Opening your browser to authorize...")
    webbrowser.open(auth_url)
    
    # 2. Start local server to catch the code
    server = HTTPServer(('localhost', 8080), OAuthHandler)
    print(f"2. Waiting for authorization on {REDIRECT_URI}...")
    server.handle_request() # This handles exactly one request
    
    if not auth_code:
        print("Error: Did not receive an authorization code.")
        return

    # 3. Exchange code for tokens
    print("3. Exchanging code for tokens...")
    token_url = "https://api.box.com/oauth2/token"
    data = {
        'grant_type': 'authorization_code',
        'code': auth_code,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET
    }
    
    response = requests.post(token_url, data=data)
    
    if response.status_code == 200:
        tokens = response.json()
        print("\n--- YOUR BOX CREDENTIALS ---")
        print(f"BOX_CLIENT_ID={CLIENT_ID}")
        print(f"BOX_CLIENT_SECRET={CLIENT_SECRET}")
        print(f"BOX_REFRESH_TOKEN={tokens.get('refresh_token')}")
        print("----------------------------")
        print("\nCopy the BOX_REFRESH_TOKEN into your .env file.")
    else:
        print(f"Error: {response.status_code}")
        print(response.text)

if __name__ == '__main__':
    get_box_tokens()
