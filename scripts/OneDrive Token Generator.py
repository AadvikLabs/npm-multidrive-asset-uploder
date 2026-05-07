import requests
import os
import urllib.parse

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

CLIENT_ID = get_env_val('MS_CLIENT_ID')
CLIENT_SECRET = get_env_val('MS_CLIENT_SECRET')

# Common redirect URI for manual copy-paste flow
REDIRECT_URI = "https://login.microsoftonline.com/common/oauth2/nativeclient"
SCOPES = "offline_access Files.ReadWrite.All"

def generate_token():
    print("=== OneDrive Refresh Token Generator ===")
    
    if not CLIENT_ID or not CLIENT_SECRET:
        print("❌ ERROR: MS_CLIENT_ID or MS_CLIENT_SECRET not found in .env file.")
        print("Please ensure you have configured these in your .env first.")
        return

    # Step 1: Generate Authorization URL
    params = {
        "client_id": CLIENT_ID,
        "response_type": "code",
        "redirect_uri": REDIRECT_URI,
        "response_mode": "query",
        "scope": SCOPES
    }
    
    auth_url = f"https://login.microsoftonline.com/common/oauth2/v2.0/authorize?{urllib.parse.urlencode(params)}"
    
    print("\n[STEP 1] Copy and paste this URL into your web browser:")
    print("-" * 60)
    print(auth_url)
    print("-" * 60)
    
    print("\n[STEP 2] Sign in and authorize the application.")
    print("\n[STEP 3] After authorizing, you will be redirected to a blank page.")
    print("Copy the ENTIRE URL of that blank page from your browser's address bar.")
    
    redirected_url = input("\nPaste the redirect URL here: ").strip()
    
    if not redirected_url:
        print("Error: No URL entered.")
        return

    # Extract the code from the URL
    try:
        parsed_url = urllib.parse.urlparse(redirected_url)
        # If they just pasted the code instead of the URL, try to use it directly
        if '=' not in redirected_url and ' ' not in redirected_url:
            code = redirected_url
        else:
            code = urllib.parse.parse_qs(parsed_url.query).get('code', [None])[0]
            
        if not code:
            # Maybe they pasted the fragment?
            code = urllib.parse.parse_qs(parsed_url.fragment).get('code', [None])[0]

        if not code:
            print("❌ ERROR: Could not find 'code' in the provided URL.")
            return
            
    except Exception as e:
        print(f"❌ ERROR: Failed to parse URL: {e}")
        return

    # Step 4: Exchange Code for Tokens
    print(f"\nExchanging code for tokens...")
    
    token_url = "https://login.microsoftonline.com/common/oauth2/v2.0/token"
    data = {
        "client_id": CLIENT_ID,
        "client_secret": CLIENT_SECRET,
        "code": code,
        "grant_type": "authorization_code",
        "redirect_uri": REDIRECT_URI
    }
    
    try:
        response = requests.post(token_url, data=data)
        result = response.json()
        
        if 'refresh_token' in result:
            print("\n✅ SUCCESS!")
            print("-" * 50)
            print("Copy this into your .env file:")
            print(f"\nMS_REFRESH_TOKEN={result['refresh_token']}")
            print("-" * 50)
            print("\nNote: Refresh tokens for OneDrive are long-lived.")
        else:
            print("\n❌ FAILED TO GET REFRESH TOKEN")
            print(f"Error: {result.get('error')}")
            print(f"Description: {result.get('error_description')}")
            
    except Exception as e:
        print(f"\n❌ Connection Error: {str(e)}")

if __name__ == '__main__':
    generate_token()
