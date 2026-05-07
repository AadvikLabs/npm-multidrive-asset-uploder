import requests
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

CLIENT_ID = get_env_val('ZOHO_CLIENT_ID')
CLIENT_SECRET = get_env_val('ZOHO_CLIENT_SECRET')

def exchange_code():
    print("=== Zoho India Permanent Token Generator (REFINED) ===")
    
    if not CLIENT_ID or not CLIENT_SECRET:
        print("❌ ERROR: ZOHO_CLIENT_ID or ZOHO_CLIENT_SECRET not found in .env file.")
        return

    print("\n[STEP 1] Go to: https://api-console.zoho.in")
    print("   (Ensure you are logged into your Zoho India account)")
    
    print("\n[STEP 2] Check your Client ID:")
    print(f"   The ID in your .env is: {CLIENT_ID}")
    print("   Does this EXACT ID appear in your India Console? (Yes/No)")
    
    print("\n[STEP 3] Copy-Paste this scope list into the 'Scope' box:")
    print("-" * 60)
    print("WorkDrive.files.ALL,WorkDrive.team.READ,ZohoFiles.files.READ,WorkDrive.files.sharing.CREATE")
    print("-" * 60)
    print("⚠️  CRITICAL: If you miss 'WorkDrive.files.sharing.CREATE', your links will require login!")
    
    print("\n[STEP 4] Ensure 'Grant Type' is 'Authorization Code'")
    print("[STEP 5] Click 'Generate', then copy the Code.")
    
    code = input("\nPaste the Code here: ").strip()
    
    if not code:
        print("Error: No code entered.")
        return

    # Trial with India endpoint
    token_url = "https://accounts.zoho.in/oauth/v2/token"
    
    data = {
        'grant_type': 'authorization_code',
        'code': code,
        'client_id': CLIENT_ID,
        'client_secret': CLIENT_SECRET
    }
    
    print(f"\nContacting Zoho India Auth Servers...")
    try:
        response = requests.post(token_url, data=data)
        result = response.json()
        
        if 'refresh_token' in result:
            print("\n✅ SUCCESS!")
            print("-" * 50)
            print(f"ZOHO_REFRESH_TOKEN={result['refresh_token']}")
            print("-" * 50)
            print("\nUpdate your .env with this token and restart your server.")
        else:
            print("\n❌ FAILED TO GET REFRESH TOKEN")
            print(f"Error: {result.get('error')}")
            if result.get('error') == 'invalid_client':
                print("\n💡 EXPLANATION: 'invalid_client' means Zoho India does not recognize your Client ID.")
                print("   This happens if your Client was created at zoho.com instead of zoho.in.")
                print("   Please create a NEW 'Server-based Application' at api-console.zoho.in")
            elif result.get('error') == 'invalid_code':
                print("\n💡 EXPLANATION: 'invalid_code' means the code has expired (it only lasts 2 mins) or already used.")
            else:
                print(f"Details: {result}")
                
    except Exception as e:
        print(f"\n❌ Connection Error: {str(e)}")

if __name__ == '__main__':
    exchange_code()
