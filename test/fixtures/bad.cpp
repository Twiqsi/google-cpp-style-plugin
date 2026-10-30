#include<bits/stdc++.h>
#include "my_header.h"
#include <vector>
#include <iostream>
using namespace std;

#define maxValue 100
const int MAX_SIZE=100;
string greeting = "hi";

class big_integer
{
public:
    big_integer(int value);
    int getSize();
    virtual void Draw() override;
private:
    int m_size;
    long long Total;
};

struct point_2d { int X; int y_; };

enum class Color { RED, GREEN };

int calcSum(int firstArg,int b){
	int result=firstArg+b; //результат
    if(result>0){
        result++;
    }
    else
    {
        result = 0 ;
    }
    for (int i=0;i<10;i++) { result += i; }
    double avg = (double)result / 2;
    int *ptr = NULL;
    char * name;
    int a, *b2;
    while (result > 100);
    if ( result == 5 ) return (result);
    for (int x: values) {}
    print (result);   
    // todo: fix
    switch (result) {
    case 1:
        break;
    }
    return result;

}
