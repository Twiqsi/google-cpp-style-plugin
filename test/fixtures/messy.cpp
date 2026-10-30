#include <iostream>
#include <cstring>
#include <cstdio>
using namespace std;

const int BASE=10;
const int MAX_DIGITS = 2026;

struct int2026_t {
    unsigned char Digits[MAX_DIGITS];
    int Size;
    bool isNegative;
};

int2026_t from_int(long long value)
{
    int2026_t result;
    memset(result.Digits,0,sizeof(result.Digits));
    result.Size=0;
    result.isNegative=value<0;
    if(value<0) value=-value;
    if (value==0) { result.Size=1; return result; }
    while(value>0){
        result.Digits[result.Size++]=(unsigned char)(value%BASE);
        value/=BASE;
    }
    return result;
}

int2026_t addNumbers(const int2026_t &a,const int2026_t &b){
	int2026_t res = from_int(0);
	int carry=0;
	int maxSize = a.Size>b.Size?a.Size:b.Size;
	for(int i=0;i<maxSize||carry;i++)
	{
		int s=carry;
		if(i<a.Size) s+=a.Digits[i];
		if(i<b.Size) s+=b.Digits[i];
		res.Digits[i]=(unsigned char)(s%BASE);
		carry=s/BASE;
		res.Size=i+1;
	}
	return res;
}

void Print(const int2026_t &x){
    if (x.isNegative) printf("-");
    for(int i=x.Size-1;i>=0;i--) printf("%d",(int)x.Digits[i]);
    printf("\n");
}

int main(){
    int2026_t a=from_int(123456789012LL),b=from_int(987654321);
    int2026_t *p = NULL;
    p=&a;
    Print(addNumbers(*p,b));
    return 0;
}
